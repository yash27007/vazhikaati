/**
 * Real road-network travel time between two points, via OSRM's public
 * routing API (router.project-osrm.org) — a build-time-only dependency
 * (this file is only ever called by generateMockGtfs.ts, never by the
 * running app), so it never becomes a runtime dependency of the deployed
 * product.
 *
 * OSRM's default driving profile estimates car travel time, not a bus's
 * (which stops more, drives slower, contends with more traffic) — a
 * BUS_TIME_MULTIPLIER inflates the car estimate to a more realistic bus
 * duration rather than presenting car-speed timing as a bus timetable.
 */

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const BUS_TIME_MULTIPLIER = 1.35;

export interface RoadRoute {
  distanceKm: number;
  busDurationMinutes: number;
}

interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number }[];
}

/** Fetches the real driving distance/duration between two lat/lon points via OSRM. */
export async function fetchRoadRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<RoadRoute> {
  const url = `${OSRM_BASE_URL}/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`);
  const body = (await response.json()) as OsrmResponse;
  if (body.code !== 'Ok' || !body.routes || body.routes.length === 0) {
    throw new Error(`OSRM returned no route (code: ${body.code})`);
  }
  const [route] = body.routes;
  return {
    distanceKm: route.distance / 1000,
    busDurationMinutes: (route.duration / 60) * BUS_TIME_MULTIPLIER,
  };
}
