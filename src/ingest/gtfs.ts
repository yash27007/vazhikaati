import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { createDb } from '../db/client';
import { agencies, stops, routes, calendars, trips, stopTimes, transfers } from '../db/schema';

export interface IngestResult {
  rowsProcessed: number;
  rowsRejected: number;
  rejections: { row: number; reason: string }[];
}

/**
 * Parses a GTFS `HH:MM:SS` time into minutes-past-midnight. GTFS allows HH
 * to exceed 24 for a trip that continues past midnight (e.g. "25:30:00" is
 * 1:30 the next service day) — that's left as-is; this project's
 * `absoluteMinutes` anchor already handles minutesPastMidnight >= 1440
 * correctly by construction (it's just added to the service day's IST
 * midnight, so it naturally rolls into the next calendar day).
 */
function parseGtfsTime(value: string): number {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`unparseable GTFS time "${value}"`);
  const [, hh, mm, ss] = match;
  return Number(hh) * 60 + Number(mm) + Number(ss) / 60;
}

/** Parses a GTFS `YYYYMMDD` date into `YYYY-MM-DD` for the `date` column. */
function parseGtfsDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{8}$/.test(trimmed)) throw new Error(`unparseable GTFS date "${trimmed}"`);
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

function readGtfsFile(feedDir: string, filename: string): Record<string, string>[] {
  const raw = readFileSync(join(feedDir, filename), 'utf-8');
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

const GTFS_ROUTE_TYPE_MAP: Record<string, string> = {
  '3': 'express', // Bus — the only mode this project's feeds use today.
};

/**
 * Ingests a standard GTFS static feed (a directory of the usual GTFS text
 * files, not a zip — unzip before calling this) into this project's
 * existing GTFS-shaped schema. Unlike the ad-hoc SETC CSV ingestion, this
 * preserves each trip's FULL stop sequence (stop_times.txt's stop_sequence
 * column), not just an origin/destination pair — a bus that passes through
 * an intermediate town is represented as actually passing through it.
 *
 * Expects: agency.txt, stops.txt, routes.txt, trips.txt, stop_times.txt,
 * calendar.txt. calendar_dates.txt / shapes.txt / fare files are ignored —
 * not needed by this project's engine.
 */
export async function ingestGtfsFeed(
  db: ReturnType<typeof createDb>,
  feedDir: string,
): Promise<IngestResult> {
  const result: IngestResult = { rowsProcessed: 0, rowsRejected: 0, rejections: [] };

  const agencyRows = readGtfsFile(feedDir, 'agency.txt');
  for (const row of agencyRows) {
    await db
      .insert(agencies)
      .values({
        agencyId: row.agency_id,
        name: row.agency_name,
        agencyType: 'state_corp',
        stateCode: 'TN',
        dataTier: 2,
      })
      .onConflictDoNothing();
  }

  // A stop this feed names may already exist under the same stopId from
  // another ingester (e.g. the SETC CSV path, which slugifies a town name
  // to the same ID this feed uses for the same real-world place) — that
  // earlier row is typically a bare name with no coordinates.
  // onConflictDoUpdate here (not onConflictDoNothing) means GTFS's fuller
  // name/coordinates always win, regardless of which ingester ran first,
  // instead of silently keeping whichever ran first's incomplete data.
  const stopRows = readGtfsFile(feedDir, 'stops.txt');
  for (const row of stopRows) {
    const lat = row.stop_lat || null;
    const lon = row.stop_lon || null;
    await db
      .insert(stops)
      .values({
        stopId: row.stop_id,
        name: row.stop_name,
        lat,
        lon,
        stopType: 'town_stand',
        townId: row.stop_id,
        dataTier: 2,
      })
      .onConflictDoUpdate({
        target: stops.stopId,
        set: { name: row.stop_name, lat, lon },
      });
  }

  const routeRows = readGtfsFile(feedDir, 'routes.txt');
  for (const row of routeRows) {
    await db
      .insert(routes)
      .values({
        routeId: row.route_id,
        agencyId: row.agency_id,
        routeShortName: row.route_short_name || null,
        routeLongName: row.route_long_name || null,
        routeType: GTFS_ROUTE_TYPE_MAP[row.route_type] ?? 'express',
      })
      .onConflictDoNothing();
  }

  const calendarRows = readGtfsFile(feedDir, 'calendar.txt');
  for (const row of calendarRows) {
    await db
      .insert(calendars)
      .values({
        serviceId: row.service_id,
        monday: row.monday === '1',
        tuesday: row.tuesday === '1',
        wednesday: row.wednesday === '1',
        thursday: row.thursday === '1',
        friday: row.friday === '1',
        saturday: row.saturday === '1',
        sunday: row.sunday === '1',
        startDate: parseGtfsDate(row.start_date),
        endDate: parseGtfsDate(row.end_date),
      })
      .onConflictDoNothing();
  }

  const tripRows = readGtfsFile(feedDir, 'trips.txt');
  for (const row of tripRows) {
    await db
      .insert(trips)
      .values({
        tripId: row.trip_id,
        routeId: row.route_id,
        serviceId: row.service_id,
        headsign: row.trip_headsign || null,
        bookable: true,
        dataTier: 2,
      })
      .onConflictDoNothing();
  }

  // stop_times.txt is the one file worth per-row rejection handling — a
  // malformed time on one stop shouldn't silently drop or corrupt the rest
  // of the same trip's sequence, and a rejected trip's remaining rows are
  // still reported individually so the reason is traceable.
  const stopTimeRows = readGtfsFile(feedDir, 'stop_times.txt');
  for (const [i, row] of stopTimeRows.entries()) {
    try {
      const arrivalMinutes = Math.round(parseGtfsTime(row.arrival_time));
      const departureMinutes = Math.round(parseGtfsTime(row.departure_time));
      const stopSequence = Number.parseInt(row.stop_sequence, 10);
      if (!Number.isFinite(stopSequence)) throw new Error('invalid stop_sequence');

      await db
        .insert(stopTimes)
        .values({
          tripId: row.trip_id,
          stopSequence,
          stopId: row.stop_id,
          arrivalMinutes,
          departureMinutes,
          haltMinutes: Math.max(0, departureMinutes - arrivalMinutes),
        })
        .onConflictDoNothing();
      result.rowsProcessed++;
    } catch (error) {
      result.rowsRejected++;
      result.rejections.push({ row: i + 1, reason: (error as Error).message });
    }
  }

  // transfers.txt is optional in the GTFS spec (not every feed has one) —
  // only ingest it if the feed actually provides one. Reads this project's
  // own generator's column (min_transfer_minutes, plain minutes) rather
  // than the official GTFS min_transfer_time (seconds) — this project's
  // transfers table has always stored minutes (see transfers.ts).
  if (existsSync(join(feedDir, 'transfers.txt'))) {
    const transferRows = readGtfsFile(feedDir, 'transfers.txt');
    for (const row of transferRows) {
      await db
        .insert(transfers)
        .values({
          fromStopId: row.from_stop_id,
          toStopId: row.to_stop_id,
          minTransferMinutes: Number(row.min_transfer_minutes),
          transferMode: 'local_bus',
        })
        .onConflictDoNothing();
    }
  }

  return result;
}
