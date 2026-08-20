import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generates a synthetic-but-standard GTFS static feed for a Tamil Nadu bus
 * network. This is MOCK DATA, not a real timetable — but the stop
 * coordinates are real (Tamil Nadu town locations), and every route's
 * travel time is estimated from real haversine distance between real
 * coordinates at an assumed average speed, the same honest-estimation
 * approach the real SETC CSV ingestion already uses (see setcCsv.ts).
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
const AVERAGE_SPEED_KMH = 40; // Slightly below the real-CSV assumption (45) to account for hill/ghat sections most of these corridors include.

interface Town {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// Real Tamil Nadu town coordinates (approximate town-centre lat/lon).
const TOWNS: Town[] = [
  { id: 'GUDALUR', name: 'Gudalur Bus Stand', lat: 11.5, lon: 76.4833 },
  { id: 'OOTY', name: 'Ooty Bus Stand', lat: 11.4064, lon: 76.6932 },
  { id: 'METTUPALAYAM', name: 'Mettupalayam Bus Stand', lat: 11.2996, lon: 76.9367 },
  { id: 'COIMBATORE', name: 'Coimbatore Central Bus Stand', lat: 11.0168, lon: 76.9558 },
  { id: 'TIRUPUR', name: 'Tirupur Bus Stand', lat: 11.1085, lon: 77.3411 },
  { id: 'DINDIGUL', name: 'Dindigul Bus Stand', lat: 10.3624, lon: 77.9695 },
  { id: 'MADURAI', name: 'Madurai Bus Stand', lat: 9.9252, lon: 78.1198 },
  { id: 'VIRUDHUNAGAR', name: 'Virudhunagar Bus Stand', lat: 9.581, lon: 77.9624 },
  { id: 'SRIVILLIPUTHUR', name: 'Srivilliputhur Bus Stand', lat: 9.5121, lon: 77.6335 },
  { id: 'RAJAPALAYAM', name: 'Rajapalayam Bus Stand', lat: 9.4517, lon: 77.5537 },
  { id: 'TENKASI', name: 'Tenkasi Bus Stand', lat: 8.9591, lon: 77.3152 },
  { id: 'SENGOTTAI', name: 'Sengottai Bus Stand', lat: 8.9667, lon: 77.25 },
  { id: 'TIRUNELVELI', name: 'Tirunelveli Junction Bus Stand', lat: 8.7139, lon: 77.7567 },
  { id: 'SALEM', name: 'Salem Central Bus Stand', lat: 11.6643, lon: 78.146 },
  { id: 'ERODE', name: 'Erode Bus Stand', lat: 11.341, lon: 77.7172 },
];

const townById = new Map(TOWNS.map((t) => [t.id, t]));

function haversineKm(a: Town, b: Town): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface MockRoute {
  id: string;
  shortName: string;
  /** Ordered stop IDs, first to last. */
  stopIds: string[];
  /** Departure times (minutes-past-midnight) of the first stop, one per daily trip. */
  departures: number[];
}

const MOCK_ROUTES: MockRoute[] = [
  // Fixes the reported gap directly: a real through-route from the
  // Nilgiris to the Kerala border that drops passengers at Srivilliputhur
  // on its way to its actual terminus, instead of Srivilliputhur only ever
  // being reachable as someone's named origin/destination.
  {
    id: 'MOCK_GUDALUR_SENGOTTAI',
    shortName: 'M1',
    stopIds: [
      'GUDALUR', 'OOTY', 'METTUPALAYAM', 'COIMBATORE', 'DINDIGUL', 'MADURAI',
      'VIRUDHUNAGAR', 'SRIVILLIPUTHUR', 'RAJAPALAYAM', 'TENKASI', 'SENGOTTAI',
    ],
    departures: [6 * 60, 14 * 60 + 30, 21 * 60], // 06:00, 14:30, 21:00
  },
  {
    id: 'MOCK_COIMBATORE_TIRUNELVELI',
    shortName: 'M2',
    stopIds: ['COIMBATORE', 'TIRUPUR', 'DINDIGUL', 'MADURAI', 'VIRUDHUNAGAR', 'TIRUNELVELI'],
    departures: [7 * 60, 15 * 60],
  },
  {
    id: 'MOCK_SALEM_MADURAI',
    shortName: 'M3',
    stopIds: ['SALEM', 'ERODE', 'TIRUPUR', 'COIMBATORE', 'DINDIGUL', 'MADURAI'],
    departures: [5 * 60 + 30, 13 * 60],
  },
  {
    id: 'MOCK_MADURAI_RAJAPALAYAM',
    shortName: 'M4',
    stopIds: ['MADURAI', 'VIRUDHUNAGAR', 'SRIVILLIPUTHUR', 'RAJAPALAYAM'],
    departures: [8 * 60, 12 * 60, 17 * 60, 20 * 60],
  },
];

function toGtfsTime(minutesPastMidnight: number): string {
  const hh = Math.floor(minutesPastMidnight / 60);
  const mm = Math.round(minutesPastMidnight % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

/** Writes a complete GTFS static feed (plain text files, not zipped) to outDir. */
export function generateMockGtfsFeed(outDir: string): void {
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

  const tripRows: string[][] = [];
  const stopTimeRows: string[][] = [];

  for (const route of MOCK_ROUTES) {
    const legKm: number[] = [];
    for (let i = 0; i < route.stopIds.length - 1; i++) {
      legKm.push(haversineKm(townById.get(route.stopIds[i])!, townById.get(route.stopIds[i + 1])!));
    }

    for (const [depIndex, firstDeparture] of route.departures.entries()) {
      const tripId = `${route.id}-${depIndex}`;
      tripRows.push([route.id, CALENDAR_ID, tripId, townById.get(route.stopIds[route.stopIds.length - 1])!.name]);

      let clock = firstDeparture;
      for (const [seqIndex, stopId] of route.stopIds.entries()) {
        if (seqIndex > 0) {
          const travelMin = (legKm[seqIndex - 1] / AVERAGE_SPEED_KMH) * 60;
          clock += travelMin;
        }
        const arrival = clock;
        // A 2-minute halt at every intermediate stop, none at the terminus.
        const isTerminus = seqIndex === 0 || seqIndex === route.stopIds.length - 1;
        const halt = isTerminus ? 0 : 2;
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
  generateMockGtfsFeed(outDir);
  console.log(`Wrote mock GTFS feed to ${outDir}/`);
}
