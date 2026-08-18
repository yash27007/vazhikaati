import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { loadConnections } from './loadConnections';

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

  test('produces comparable absolute times across two different dates', async () => {
    const { connections } = await loadConnections(db, ['2026-08-16', '2026-08-17']);
    const day1 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && new Date(c.departureAbsMin * 60000).toISOString().startsWith('2026-08-16'));
    const day2 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && new Date(c.departureAbsMin * 60000).toISOString().startsWith('2026-08-17'));
    expect(day1).toBeDefined();
    expect(day2).toBeDefined();
    expect(day2!.departureAbsMin - day1!.departureAbsMin).toBe(24 * 60);
  });
});
