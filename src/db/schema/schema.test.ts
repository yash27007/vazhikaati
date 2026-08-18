import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../testDb';
import { agencies, stops, routes, calendars, trips, stopTimes } from './index';

describe('ledger schema', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('accepts a minimal valid row per table and enforces the agency_type check', async () => {
    await db.insert(agencies).values({
      agencyId: 'TEST_AGENCY',
      name: 'Test Agency',
      agencyType: 'division',
      stateCode: 'TN',
    });
    await db.insert(stops).values([
      { stopId: 'A', name: 'Stop A', stopType: 'town_stand' },
      { stopId: 'B', name: 'Stop B', stopType: 'town_stand' },
    ]);
    await db.insert(routes).values({
      routeId: 'R1',
      agencyId: 'TEST_AGENCY',
      routeType: 'ultra_deluxe',
    });
    await db.insert(calendars).values({
      serviceId: 'DAILY',
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
    await db.insert(trips).values({ tripId: 'T1', routeId: 'R1', serviceId: 'DAILY' });
    await db.insert(stopTimes).values([
      { tripId: 'T1', stopSequence: 1, stopId: 'A', arrivalMinutes: 600, departureMinutes: 600 },
      { tripId: 'T1', stopSequence: 2, stopId: 'B', arrivalMinutes: 660, departureMinutes: 660 },
    ]);

    const found = await db.select().from(trips);
    expect(found).toHaveLength(1);

    // Wrapped in Promise.resolve(): Drizzle's query builder is a thenable,
    // not a real Promise instance, and bun:test's `expect().rejects`
    // requires `instanceof Promise`.
    await expect(
      Promise.resolve(
        db.insert(agencies).values({
          agencyId: 'BAD',
          name: 'Bad Agency',
          agencyType: 'not_a_real_type',
          stateCode: 'TN',
        }),
      ),
    ).rejects.toThrow();
  });
});
