import { describe, test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { stopTimes, stops, transfers } from '../db/schema';
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

  test('enriches a stop that already exists (e.g. from another ingester) with the GTFS name and coordinates', async () => {
    // Simulates the real collision: the SETC CSV ingester creates a bare
    // stop row (raw town name, no coordinates) for a town that the GTFS
    // feed ALSO names — same real-world place, same slugified stop ID. The
    // GTFS feed's richer name/coordinates must not be silently dropped by
    // onConflictDoNothing just because the other ingester ran first.
    await db.insert(stops).values({ stopId: 'FIX_A', name: 'FIX_A', stopType: 'town_stand', townId: 'FIX_A', dataTier: 1 });

    await ingestGtfsFeed(db, FIXTURE_DIR);

    const [row] = await db.select().from(stops).where(eq(stops.stopId, 'FIX_A'));
    expect(row.name).toBe('Fixture Town A');
    expect(row.lat).not.toBeNull();
    expect(row.lon).not.toBeNull();
  });

  test('ingests transfers.txt when the feed provides one', async () => {
    await ingestGtfsFeed(db, FIXTURE_DIR);

    const rows = await db.select().from(transfers).where(eq(transfers.fromStopId, 'FIX_A'));
    expect(rows).toHaveLength(1);
    expect(rows[0].toStopId).toBe('FIX_C');
    expect(rows[0].minTransferMinutes).toBe(20);
  });

  test('is idempotent — re-running does not duplicate or error', async () => {
    await ingestGtfsFeed(db, FIXTURE_DIR);
    const result = await ingestGtfsFeed(db, FIXTURE_DIR);
    expect(result.rowsRejected).toBe(0);

    const rows = await db.select().from(stopTimes).where(eq(stopTimes.tripId, 'FIX_TRIP_1'));
    expect(rows).toHaveLength(3);
  });
});
