import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { stops, stopTimes, transfers } from '../db/schema';
import { ingestDemoCorridor } from './demoCorridor';

describe('ingestDemoCorridor', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('creates all six stops, flagged tier 3, with the Tirupur stands unsafe overnight', async () => {
    await ingestDemoCorridor(db);

    const allStops = await db.select().from(stops);
    expect(allStops.map((s) => s.stopId).sort()).toEqual(
      [
        'MADURAI_STAND',
        'METTUPALAYAM_STAND',
        'OOTY_STAND',
        'SRIVILLIPUTHUR_STAND',
        'TIRUPUR_NEW_STAND',
        'TIRUPUR_OLD_STAND',
      ].sort(),
    );
    expect(allStops.every((s) => s.dataTier === 3)).toBe(true);

    const [tirupurOld] = await db.select().from(stops).where(eq(stops.stopId, 'TIRUPUR_OLD_STAND'));
    expect(tirupurOld.safeOvernight).toBe(false);
  });

  test('creates the Tirupur cross-stand transfer', async () => {
    await ingestDemoCorridor(db);
    const [transfer] = await db
      .select()
      .from(transfers)
      .where(eq(transfers.fromStopId, 'TIRUPUR_OLD_STAND'));
    expect(transfer.toStopId).toBe('TIRUPUR_NEW_STAND');
    expect(transfer.minTransferMinutes).toBe(10);
  });

  test('reproduces the exact worked-example timings', async () => {
    await ingestDemoCorridor(db);

    const legTimes = async (tripId: string) => {
      const legs = await db.select().from(stopTimes).where(eq(stopTimes.tripId, tripId));
      const origin = legs.find((l) => l.stopSequence === 1)!;
      const dest = legs.find((l) => l.stopSequence === 2)!;
      return { dep: origin.departureMinutes, arr: dest.arrivalMinutes };
    };

    expect(await legTimes('OOTY_MTP_A')).toEqual({ dep: 15 * 60 + 40, arr: 17 * 60 + 10 });
    expect(await legTimes('OOTY_MTP_B')).toEqual({ dep: 17 * 60 + 20, arr: 18 * 60 + 50 });
    expect(await legTimes('MTP_TPR_B')).toEqual({ dep: 19 * 60 + 45, arr: 21 * 60 + 40 });
    expect(await legTimes('TPR_MDU_LAST')).toEqual({ dep: 21 * 60 + 15, arr: 22 * 60 });
    expect(await legTimes('TPR_MDU_EARLY')).toEqual({ dep: 4 * 60 + 30, arr: 5 * 60 + 15 });
  });
});
