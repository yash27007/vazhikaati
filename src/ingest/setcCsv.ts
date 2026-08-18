import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { createDb } from '../db/client';
import { agencies, stops, routes, calendars, trips, stopTimes } from '../db/schema';
import { parseDepartureTimings } from './parseTiming';

const AVERAGE_SPEED_KMH = 45;
const DAILY_CALENDAR_ID = 'SETC_DAILY';

interface CsvRow {
  'Sl. No.': string;
  Depot: string;
  'Route No.': string;
  From: string;
  To: string;
  'Route Length': string;
  Type: string;
  'No.of Service': string;
  'Departure Timings': string;
}

export interface IngestResult {
  rowsProcessed: number;
  rowsRejected: number;
  rejections: { row: number; reason: string }[];
}

function slugifyStopName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function mapRouteType(csvType: string): 'ultra_deluxe' | 'ac' {
  return csvType.trim().toUpperCase() === 'A/C' ? 'ac' : 'ultra_deluxe';
}

export async function ingestSetcCsv(
  db: ReturnType<typeof createDb>,
  csvPath: string,
): Promise<IngestResult> {
  const raw = readFileSync(csvPath, 'utf-8');
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  const result: IngestResult = { rowsProcessed: 0, rowsRejected: 0, rejections: [] };
  const seenAgencies = new Set<string>();
  const seenStops = new Set<string>();

  await db
    .insert(calendars)
    .values({
      serviceId: DAILY_CALENDAR_ID,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
      // No calendar data exists in the source CSV — every imported trip is
      // assumed to run daily. Documented assumption, not a fabricated fact.
      startDate: '2020-01-01',
      endDate: '2035-12-31',
    })
    .onConflictDoNothing();

  for (const row of rows) {
    const rowNum = Number.parseInt(row['Sl. No.'], 10);
    try {
      const depot = row.Depot?.trim();
      const fromName = row.From?.trim();
      const toName = row.To?.trim();
      const lengthKm = Number.parseFloat(row['Route Length']);
      if (!depot || !fromName || !toName || !Number.isFinite(lengthKm) || lengthKm <= 0) {
        throw new Error('missing or invalid depot/from/to/route-length');
      }
      const departures = parseDepartureTimings(row['Departure Timings']);
      if (departures.length === 0) {
        throw new Error('no parseable departure timings');
      }

      if (!seenAgencies.has(depot)) {
        await db
          .insert(agencies)
          .values({
            agencyId: depot,
            name: `SETC ${depot}`,
            agencyType: 'division',
            stateCode: 'TN',
            dataTier: 1,
          })
          .onConflictDoNothing();
        seenAgencies.add(depot);
      }

      for (const townName of [fromName, toName]) {
        const stopId = slugifyStopName(townName);
        if (!seenStops.has(stopId)) {
          await db
            .insert(stops)
            .values({
              stopId,
              name: townName,
              stopType: 'town_stand',
              townId: stopId,
              dataTier: 1,
            })
            .onConflictDoNothing();
          seenStops.add(stopId);
        }
      }

      const fromStopId = slugifyStopName(fromName);
      const toStopId = slugifyStopName(toName);
      // Depot + Route No. alone is not unique: the real SETC CSV has
      // reverse-direction pairs sharing both (e.g. CB/468TU CHENNAI->OOTY
      // and CB/468TU OOTY->CHENNAI). Folding from/to stop ids into the
      // route id keeps each direction distinct instead of the second
      // direction's trips/stopTimes silently colliding on primary key and
      // being dropped by onConflictDoNothing.
      const routeId = `${depot}-${row['Route No.'].trim()}-${fromStopId}-${toStopId}`;
      await db
        .insert(routes)
        .values({
          routeId,
          agencyId: depot,
          routeShortName: row['Route No.'].trim(),
          routeLongName: `${fromName} - ${toName}`,
          routeType: mapRouteType(row.Type),
        })
        .onConflictDoNothing();

      const travelMinutes = Math.round((lengthKm / AVERAGE_SPEED_KMH) * 60);

      for (const [index, departureMinutes] of departures.entries()) {
        const tripId = `${routeId}-${index}`;
        await db
          .insert(trips)
          .values({
            tripId,
            routeId,
            serviceId: DAILY_CALENDAR_ID,
            headsign: toName,
            vehicleType: row.Type.trim(),
            bookable: true,
            dataTier: 1,
          })
          .onConflictDoNothing();

        await db
          .insert(stopTimes)
          .values([
            {
              tripId,
              stopSequence: 1,
              stopId: fromStopId,
              arrivalMinutes: departureMinutes,
              departureMinutes,
              haltMinutes: 0,
            },
            {
              tripId,
              stopSequence: 2,
              stopId: toStopId,
              arrivalMinutes: departureMinutes + travelMinutes,
              departureMinutes: departureMinutes + travelMinutes,
              haltMinutes: 0,
            },
          ])
          .onConflictDoNothing();
      }

      result.rowsProcessed++;
    } catch (error) {
      result.rowsRejected++;
      result.rejections.push({ row: rowNum, reason: (error as Error).message });
    }
  }

  return result;
}
