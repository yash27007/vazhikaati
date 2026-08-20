import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchRoadRoute } from './osrmRoute';

/**
 * Generates a synthetic-but-standard GTFS static feed for a Tamil Nadu bus
 * network. This is MOCK DATA, not a real timetable — schedules and trip IDs
 * are synthetic — but stop coordinates are real bus-stand locations, and
 * every leg's travel time is a REAL road-network estimate (OSRM's public
 * routing API, driving the actual road geometry — ghats, curves, and all —
 * not a flat haversine-distance guess), scaled by a bus-realism multiplier.
 * See osrmRoute.ts.
 *
 * Corridor topology (which towns a route passes through, in what order) was
 * confirmed against real travel experience, not invented: notably, the
 * Ooty–deep-south corridor runs via Tiruppur, not Coimbatore — an earlier
 * version of this generator had that wrong.
 *
 * Why this exists: the real SETC CSV only ever lists an origin/destination
 * pair per row, with no intermediate stops — a bus that passes through and
 * drops off at a town partway along its route is invisible to the system.
 * GTFS's stop_times.txt natively supports a full ordered stop sequence per
 * trip, so this feed models routes the way they actually run: as a chain
 * of real stops, not just two endpoints. If Tamil Nadu's transport
 * department ever publishes a real feed in this format, it drops into the
 * same ingestGtfsFeed() this mock data goes through, unchanged.
 */

const AGENCY_ID = 'MOCK_TNSTC';
const CALENDAR_ID = 'MOCK_DAILY';
const INTERMEDIATE_HALT_MINUTES = 3;
// Politeness delay between calls to the public OSRM demo server.
const OSRM_CALL_DELAY_MS = 250;

interface Town {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// Real Tamil Nadu bus-stand locations.
const TOWNS: Town[] = [
  { id: 'CHENNAI_KCBT', name: 'Kalaignar Centenary Bus Terminus, Kilambakkam', lat: 12.8726, lon: 80.0821 },
  { id: 'VILUPPURAM', name: 'Viluppuram New Bus Stand', lat: 11.9401, lon: 79.4861 },
  { id: 'TRICHY', name: 'Tiruchirappalli Central Bus Stand', lat: 10.7986, lon: 78.6804 },
  { id: 'MDU_MATTUTHAVANI', name: 'Madurai Mattuthavani Bus Stand', lat: 9.9449, lon: 78.1568 },
  { id: 'MDU_ARAPALAYAM', name: 'Madurai Arapalayam Bus Stand', lat: 9.9329, lon: 78.1072 },
  { id: 'TIRUNELVELI', name: 'Tirunelveli New Bus Stand', lat: 8.7025, lon: 77.7278 },
  { id: 'COIMBATORE', name: 'Coimbatore Gandhipuram Central', lat: 11.0168, lon: 76.9673 },
  { id: 'TIRUPUR', name: 'Tiruppur Bus Stand', lat: 11.1085, lon: 77.3411 },
  { id: 'ERODE', name: 'Erode Central Bus Stand', lat: 11.3444, lon: 77.7121 },
  { id: 'SALEM', name: 'Salem New Bus Stand', lat: 11.6704, lon: 78.1396 },
  { id: 'OOTY', name: 'Ooty Central Bus Stand', lat: 11.4087, lon: 76.6976 },
  { id: 'COONOOR', name: 'Coonoor Bus Stand', lat: 11.353, lon: 76.7959 },
  { id: 'METTUPALAYAM', name: 'Mettupalayam Bus Stand', lat: 11.3005, lon: 76.9406 },
  { id: 'PALLADAM', name: 'Palladam Bus Stand', lat: 10.9983, lon: 77.2941 },
  { id: 'DHARAPURAM', name: 'Dharapuram Bus Stand', lat: 10.7303, lon: 77.5303 },
  { id: 'ODDANCHATRAM', name: 'Oddanchatram Bus Stand', lat: 10.4856, lon: 77.7472 },
  { id: 'DINDIGUL', name: 'Dindigul Central Bus Stand', lat: 10.3624, lon: 77.9695 },
  { id: 'VIRUDHUNAGAR', name: 'Virudhunagar Old Bus Stand', lat: 9.5855, lon: 77.9579 },
  { id: 'SRIVILLIPUTHUR', name: 'Srivilliputhur Bus Stand', lat: 9.5103, lon: 77.6322 },
  { id: 'RAJAPALAYAM', name: 'Rajapalayam Old Bus Stand', lat: 9.4533, lon: 77.5547 },
  { id: 'SENGOTTAI', name: 'Sengottai Bus Stand', lat: 8.9806, lon: 77.2403 },
];

const townById = new Map(TOWNS.map((t) => [t.id, t]));

interface MockRoute {
  id: string;
  shortName: string;
  /** Ordered stop IDs, first to last — the real corridor a bus actually follows. */
  stopIds: string[];
  /** Departure times (minutes-past-midnight) of the first stop, one per daily trip. */
  departures: number[];
}

const MOCK_ROUTES: MockRoute[] = [
  {
    // The corridor a real user confirmed from personal travel: Ooty to the
    // deep south runs via Tiruppur, not Coimbatore.
    id: 'MOCK_OOTY_SENGOTTAI',
    shortName: 'OOTY-SGT',
    stopIds: [
      'OOTY', 'COONOOR', 'METTUPALAYAM', 'PALLADAM', 'DHARAPURAM', 'ODDANCHATRAM',
      'DINDIGUL', 'MDU_MATTUTHAVANI', 'VIRUDHUNAGAR', 'SRIVILLIPUTHUR', 'RAJAPALAYAM', 'SENGOTTAI',
    ],
    departures: [6 * 60, 14 * 60 + 30, 21 * 60],
  },
  {
    // Shares the Tiruppur -> Dharapuram -> Dindigul segment with the route
    // above — the same real road the Coimbatore-origin buses use.
    id: 'MOCK_CBE_MADURAI',
    shortName: 'CBE-MDU',
    stopIds: ['COIMBATORE', 'TIRUPUR', 'DHARAPURAM', 'ODDANCHATRAM', 'DINDIGUL', 'MDU_ARAPALAYAM'],
    departures: [7 * 60, 15 * 60],
  },
  {
    id: 'MOCK_CBE_SALEM',
    shortName: 'CBE-SLM',
    stopIds: ['COIMBATORE', 'TIRUPUR', 'ERODE', 'SALEM'],
    departures: [8 * 60, 13 * 60],
  },
  {
    id: 'MOCK_CHENNAI_TIRUNELVELI',
    shortName: '137UD',
    stopIds: ['CHENNAI_KCBT', 'VILUPPURAM', 'TRICHY', 'MDU_MATTUTHAVANI', 'TIRUNELVELI'],
    departures: [7 * 60, 22 * 60],
  },
  {
    id: 'MOCK_TRICHY_MADURAI',
    shortName: 'TRZ-MDU',
    stopIds: ['TRICHY', 'MDU_MATTUTHAVANI'],
    departures: [23 * 60],
  },
];

// The two Madurai bus stands are a real intra-city transfer, not adjacent
// stops on any one route — a 35-minute city transfer, not a bus leg.
const TRANSFERS: { fromStopId: string; toStopId: string; minTransferMinutes: number }[] = [
  { fromStopId: 'MDU_MATTUTHAVANI', toStopId: 'MDU_ARAPALAYAM', minTransferMinutes: 35 },
  { fromStopId: 'MDU_ARAPALAYAM', toStopId: 'MDU_MATTUTHAVANI', minTransferMinutes: 35 },
];

function toGtfsTime(minutesPastMidnight: number): string {
  const hh = Math.floor(minutesPastMidnight / 60);
  const mm = Math.round(minutesPastMidnight % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

/** Quotes a CSV field per RFC 4180 if it contains a comma, quote, or newline — several of this project's real stop names do (e.g. "Kalaignar Centenary Bus Terminus, Kilambakkam"). */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(headers: string[], rows: string[][]): string {
  const csvRows = [headers, ...rows].map((row) => row.map(csvField).join(','));
  return csvRows.join('\n') + '\n';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes a complete GTFS static feed (plain text files, not zipped) to
 * outDir. Async: fetches real road-network travel times from OSRM for
 * every consecutive stop pair used by any route (cached, so a shared
 * segment like Tiruppur -> Dharapuram is only fetched once).
 */
export async function generateMockGtfsFeed(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, 'agency.txt'),
    toCsv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], [
      [AGENCY_ID, 'Mock TNSTC (synthetic demo data)', 'https://example.invalid', 'Asia/Kolkata'],
    ]),
  );

  writeFileSync(
    join(outDir, 'stops.txt'),
    toCsv(
      ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
      TOWNS.map((t) => [t.id, t.name, t.lat.toFixed(6), t.lon.toFixed(6)]),
    ),
  );

  writeFileSync(
    join(outDir, 'routes.txt'),
    toCsv(
      ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      MOCK_ROUTES.map((r) => [
        r.id,
        AGENCY_ID,
        r.shortName,
        `${townById.get(r.stopIds[0])!.name} - ${townById.get(r.stopIds[r.stopIds.length - 1])!.name}`,
        '3',
      ]),
    ),
  );

  writeFileSync(
    join(outDir, 'calendar.txt'),
    toCsv(
      ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
      [[CALENDAR_ID, '1', '1', '1', '1', '1', '1', '1', '20200101', '20351231']],
    ),
  );

  writeFileSync(
    join(outDir, 'transfers.txt'),
    toCsv(
      ['from_stop_id', 'to_stop_id', 'min_transfer_minutes'],
      TRANSFERS.map((t) => [t.fromStopId, t.toStopId, String(t.minTransferMinutes)]),
    ),
  );

  // Fetch real road travel time for every consecutive stop pair any route
  // uses, caching shared segments (e.g. TIRUPUR -> DHARAPURAM appears in
  // two routes) so each unique pair is only fetched once.
  const legMinutesCache = new Map<string, number>();
  async function legMinutes(fromId: string, toId: string): Promise<number> {
    const key = `${fromId}>${toId}`;
    const cached = legMinutesCache.get(key);
    if (cached !== undefined) return cached;

    const from = townById.get(fromId)!;
    const to = townById.get(toId)!;
    const { busDurationMinutes } = await fetchRoadRoute(from.lat, from.lon, to.lat, to.lon);
    legMinutesCache.set(key, busDurationMinutes);
    await sleep(OSRM_CALL_DELAY_MS);
    return busDurationMinutes;
  }

  const tripRows: string[][] = [];
  const stopTimeRows: string[][] = [];

  for (const route of MOCK_ROUTES) {
    const legMin: number[] = [];
    for (let i = 0; i < route.stopIds.length - 1; i++) {
      legMin.push(await legMinutes(route.stopIds[i], route.stopIds[i + 1]));
    }

    for (const [depIndex, firstDeparture] of route.departures.entries()) {
      const tripId = `${route.id}-${depIndex}`;
      tripRows.push([route.id, CALENDAR_ID, tripId, townById.get(route.stopIds[route.stopIds.length - 1])!.name]);

      let clock = firstDeparture;
      for (const [seqIndex, stopId] of route.stopIds.entries()) {
        if (seqIndex > 0) clock += legMin[seqIndex - 1];

        const arrival = clock;
        const isTerminus = seqIndex === 0 || seqIndex === route.stopIds.length - 1;
        const halt = isTerminus ? 0 : INTERMEDIATE_HALT_MINUTES;
        const departure = clock + halt;
        clock = departure;

        stopTimeRows.push([tripId, toGtfsTime(arrival), toGtfsTime(departure), stopId, String(seqIndex + 1)]);
      }
    }
  }

  writeFileSync(join(outDir, 'trips.txt'), toCsv(['route_id', 'service_id', 'trip_id', 'trip_headsign'], tripRows));
  writeFileSync(
    join(outDir, 'stop_times.txt'),
    toCsv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], stopTimeRows),
  );
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? 'mock-gtfs-feed';
  await generateMockGtfsFeed(outDir);
  console.log(`Wrote mock GTFS feed to ${outDir}/`);
}
