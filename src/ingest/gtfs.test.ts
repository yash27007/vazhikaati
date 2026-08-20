import { describe, test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { stopTimes } from '../db/schema';
import { ingestGtfsFeed } from './gtfs';

const FIXTURE_DIR = join(import.meta.dir, 'fixtures/gtfs-sample');

describe('ingestGtfsFeed', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('ingests every GTFS file into the matching table, rejecting nothing', async () => {
    const result = await ingestGtfsFeed(db, FIXTURE_DIR);
    expect(result.rowsRejected).toBe(0);
    expect(result.rowsProcessed).toBe(3); // 3 stop_times rows
  });

  test('preserves the full stop sequence of a trip, including the intermediate stop', async () => {
    await ingestGtfsFeed(db, FIXTURE_DIR);

    const rows = await db
      .select()
      .from(stopTimes)
      .where(eq(stopTimes.tripId, 'FIX_TRIP_1'))
      .orderBy(asc(stopTimes.stopSequence));

    // This is the exact capability the SETC CSV ingestion lacks: a trip
    // with a real intermediate stop (FIX_B), not just an origin/destination
    // pair.
    expect(rows.map((r) => r.stopId)).toEqual(['FIX_A', 'FIX_B', 'FIX_C']);
    expect(rows[1].arrivalMinutes).toBe(9 * 60 + 15);
    expect(rows[1].departureMinutes).toBe(9 * 60 + 20);
    expect(rows[1].haltMinutes).toBe(5);
  });

  test('is idempotent — re-running does not duplicate or error', async () => {
    await ingestGtfsFeed(db, FIXTURE_DIR);
    const result = await ingestGtfsFeed(db, FIXTURE_DIR);
    expect(result.rowsRejected).toBe(0);

    const rows = await db.select().from(stopTimes).where(eq(stopTimes.tripId, 'FIX_TRIP_1'));
    expect(rows).toHaveLength(3);
  });
});
