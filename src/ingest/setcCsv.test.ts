import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { agencies, stops, routes, trips, stopTimes } from '../db/schema';
import { ingestSetcCsv } from './setcCsv';

describe('ingestSetcCsv', () => {
  const db = setupTestDb();
  const fixturePath = `${import.meta.dir}/fixtures/sample.csv`;

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('imports valid rows and rejects invalid ones', async () => {
    const result = await ingestSetcCsv(db, fixturePath);

    expect(result.rowsProcessed).toBe(3);
    expect(result.rowsRejected).toBe(2);
    expect(result.rejections.map((r) => r.row).sort()).toEqual([4, 5]);
  });

  test('derives arrival time from route length at 45 km/h and tags data_tier 1', async () => {
    await ingestSetcCsv(db, fixturePath);

    const [trip] = await db.select().from(trips).where(eq(trips.tripId, 'SHN-192UD-0'));
    expect(trip.dataTier).toBe(1);

    const legs = await db
      .select()
      .from(stopTimes)
      .where(eq(stopTimes.tripId, 'SHN-192UD-0'));
    const origin = legs.find((l) => l.stopSequence === 1)!;
    const dest = legs.find((l) => l.stopSequence === 2)!;
    expect(origin.departureMinutes).toBe(17 * 60 + 45);
    // 657 km / 45 km/h = 876 minutes, rounded
    expect(dest.arrivalMinutes).toBe(17 * 60 + 45 + Math.round((657 / 45) * 60));
  });

  test('creates one trip per departure time and maps A/C to the ac route type', async () => {
    await ingestSetcCsv(db, fixturePath);

    const acTrips = await db.select().from(trips).where(eq(trips.routeId, 'CB-470AC'));
    expect(acTrips).toHaveLength(1);

    const [route] = await db.select().from(routes).where(eq(routes.routeId, 'CBE-838UD'));
    expect(route.routeType).toBe('ultra_deluxe');

    const multiTrips = await db.select().from(trips).where(eq(trips.routeId, 'CBE-838UD'));
    expect(multiTrips).toHaveLength(2); // "08.30,20.3" -> two departures
  });

  test('is idempotent — running it twice does not duplicate or error', async () => {
    await ingestSetcCsv(db, fixturePath);
    await ingestSetcCsv(db, fixturePath);

    const allTrips = await db.select().from(trips);
    // 3 valid rows -> 4 trips total: SHN-192UD (1) + CB-470AC (1) + CBE-838UD (2, one per departure).
    expect(allTrips).toHaveLength(4);
  });
});
