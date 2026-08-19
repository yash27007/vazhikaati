import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { loadConnections } from './loadConnections';
import { istCalendarDate } from './shared';

describe('loadConnections', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('expands trips into date-anchored connections and includes the transfer edge', async () => {
    const { connections, transferEdges } = await loadConnections(db, ['2026-08-16']);

    const ootyLegs = connections.filter((c) => c.fromStopId === 'OOTY_STAND');
    expect(ootyLegs).toHaveLength(3); // EARLY, A, B

    expect(transferEdges).toEqual([
      { fromStopId: 'TIRUPUR_OLD_STAND', toStopId: 'TIRUPUR_NEW_STAND', minTransferMinutes: 10 },
    ]);
  });

  test('anchors an early-morning departure to the correct IST calendar day, not the UTC day', async () => {
    const { connections } = await loadConnections(db, ['2026-08-16']);
    const earlyDeparture = connections.find((c) => c.tripId === 'TPR_MDU_EARLY');
    expect(earlyDeparture).toBeDefined();
    // TPR_MDU_EARLY departs at minute 270 (04:30 IST) on 2026-08-16. That
    // instant is 2026-08-15T23:00:00Z in UTC — if this were still anchored
    // to UTC midnight (the bug this task fixes), it would instead land on
    // 2026-08-16T04:30:00.000Z.
    expect(new Date(earlyDeparture!.departureAbsMin * 60000).toISOString()).toBe('2026-08-15T23:00:00.000Z');
  });

  test('produces comparable absolute times across two different dates', async () => {
    const { connections } = await loadConnections(db, ['2026-08-16', '2026-08-17']);
    const day1 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && istCalendarDate(c.departureAbsMin) === '2026-08-16');
    const day2 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && istCalendarDate(c.departureAbsMin) === '2026-08-17');
    expect(day1).toBeDefined();
    expect(day2).toBeDefined();
    expect(day2!.departureAbsMin - day1!.departureAbsMin).toBe(24 * 60);
  });
});
