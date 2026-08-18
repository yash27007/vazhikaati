import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { routes, trips, stopTimes } from '../db/schema';
import { ingestSetcCsv } from './setcCsv';

describe('ingestSetcCsv', () => {
  const db = setupTestDb();
  const fixturePath = `${import.meta.dir}/fixtures/sample.csv`;

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('imports valid rows and rejects invalid ones', async () => {
    const result = await ingestSetcCsv(db, fixturePath);

    // 5 valid rows (1, 2, 3, 6, 7) plus 2 rejected (4: missing From, 5: unparseable timing).
    expect(result.rowsProcessed).toBe(5);
    expect(result.rowsRejected).toBe(2);
    expect(result.rejections.map((r) => r.row).sort()).toEqual([4, 5]);
  });

  test('derives arrival time from route length at 45 km/h and tags data_tier 1', async () => {
    await ingestSetcCsv(db, fixturePath);

    const tripId = 'SHN-192UD-ALANKULAM-CHENNAI-0';
    const [trip] = await db.select().from(trips).where(eq(trips.tripId, tripId));
    expect(trip.dataTier).toBe(1);

    const legs = await db.select().from(stopTimes).where(eq(stopTimes.tripId, tripId));
    const origin = legs.find((l) => l.stopSequence === 1)!;
    const dest = legs.find((l) => l.stopSequence === 2)!;
    expect(origin.departureMinutes).toBe(17 * 60 + 45);
    // 657 km / 45 km/h = 876 minutes, rounded
    expect(dest.arrivalMinutes).toBe(17 * 60 + 45 + Math.round((657 / 45) * 60));
  });

  test('creates one trip per departure time and maps A/C to the ac route type', async () => {
    await ingestSetcCsv(db, fixturePath);

    const acRouteId = 'CB-470AC-CHENNAI-TIRUPPUR';
    const acTrips = await db.select().from(trips).where(eq(trips.routeId, acRouteId));
    expect(acTrips).toHaveLength(1);

    const [acRoute] = await db.select().from(routes).where(eq(routes.routeId, acRouteId));
    expect(acRoute.routeType).toBe('ac');

    const multiRouteId = 'CBE-838UD-BANGALORE-COIMBATORE';
    const [route] = await db.select().from(routes).where(eq(routes.routeId, multiRouteId));
    expect(route.routeType).toBe('ultra_deluxe');

    const multiTrips = await db.select().from(trips).where(eq(trips.routeId, multiRouteId));
    expect(multiTrips).toHaveLength(2); // "08.30,20.3" -> two departures
  });

  test('keeps reverse-direction rows sharing a Depot+Route No. as distinct routes and trips', async () => {
    const result = await ingestSetcCsv(db, fixturePath);

    const outboundRouteId = 'CB-468TU-CHENNAI-OOTY';
    const inboundRouteId = 'CB-468TU-OOTY-CHENNAI';

    const outboundRoutes = await db.select().from(routes).where(eq(routes.routeId, outboundRouteId));
    const inboundRoutes = await db.select().from(routes).where(eq(routes.routeId, inboundRouteId));
    expect(outboundRoutes).toHaveLength(1);
    expect(inboundRoutes).toHaveLength(1);

    const outboundTrips = await db.select().from(trips).where(eq(trips.routeId, outboundRouteId));
    const inboundTrips = await db.select().from(trips).where(eq(trips.routeId, inboundRouteId));
    expect(outboundTrips).toHaveLength(1);
    expect(inboundTrips).toHaveLength(1);

    // Neither direction's row should have been rejected due to an id collision.
    expect(result.rejections.some((r) => r.row === 6 || r.row === 7)).toBe(false);
  });

  test('is idempotent — running it twice does not duplicate or error', async () => {
    await ingestSetcCsv(db, fixturePath);
    await ingestSetcCsv(db, fixturePath);

    const allTrips = await db.select().from(trips);
    // 5 valid rows -> 6 trips total: SHN-192UD (1) + CB-470AC (1) +
    // CBE-838UD (2, one per departure) + CB-468TU CHENNAI->OOTY (1) +
    // CB-468TU OOTY->CHENNAI (1).
    expect(allTrips).toHaveLength(6);
  });
});
