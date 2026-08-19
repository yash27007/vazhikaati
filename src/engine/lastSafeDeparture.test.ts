import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { findLastSafeDeparture } from './lastSafeDeparture';

describe('findLastSafeDeparture', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('picks the 15:40 Ooty departure, not the earlier 08:00 one, as the last safe option', async () => {
    const result = await findLastSafeDeparture(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      arriveBy: '2026-08-17T08:00:00Z',
    });

    expect(result.found).toBe(true);
    expect(result.legs[0].tripId).toBe('OOTY_MTP_A'); // the 15:40 departure
    expect(result.legs.map((l) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
  });

  test('explains that the next Ooty departure strands the traveller at Tirupur until 04:30', async () => {
    const result = await findLastSafeDeparture(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      arriveBy: '2026-08-17T08:00:00Z',
    });

    expect(result.breakExplanation).toBeTruthy();
    expect(result.breakExplanation).toContain('TIRUPUR_NEW_STAND');
  });

  test('reports not found when no chain can meet the deadline', async () => {
    // The demo corridor's calendar runs an unconditional daily service, so any
    // deadline that falls within its validity window is reachable via *some*
    // prior day's occurrence once the backward search's horizonDays (3 by
    // default) reaches back far enough — a "same time yesterday" deadline is
    // never truly impossible for a repeating schedule. To get a deadline that
    // is genuinely infeasible regardless of how far back the search looks, we
    // go back before the calendar's startDate (2020-01-01, see demoCorridor.ts)
    // entirely: every date in the search window then fails the calendar's
    // startDate check in loadConnections, so zero connections are loaded and
    // the scan can only report not found.
    const result = await findLastSafeDeparture(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      arriveBy: '2019-12-30T00:00:00Z', // before the calendar's 2020-01-01 startDate
    });
    expect(result.found).toBe(false);
    expect(result.breakExplanation).toBeNull();
  });
});
