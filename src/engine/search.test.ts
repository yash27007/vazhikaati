import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { planJourney } from './search';

describe('planJourney', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('finds the full 4-leg Ooty -> Srivilliputhur chain departing at 15:40', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00',
    });

    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
  });

  test('scores the Tirupur transfer tight (tier-3 capped) and the Madurai transfer tight', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00',
    });

    const tirupurLeg = result.legs.find((l) => l.tripId === 'TPR_MDU_LAST')!;
    const maduraiLeg = result.legs.find((l) => l.tripId === 'MDU_SVP_LAST')!;
    // The demo corridor is entirely tier-3 (synthetic) data, so a band that
    // would otherwise compute as "safe" is capped at "tight" per scoreConfidence.
    expect(tirupurLeg.confidence).toBe('tight');
    expect(maduraiLeg.confidence).toBe('tight');
    expect(result.overallConfidence).toBe('tight');
  });

  test('can use a transfer edge at the search origin, before any bus leg', async () => {
    // TIRUPUR_OLD_STAND has no direct departures of its own in the demo
    // corridor — the only way onward from it is the transfer to
    // TIRUPUR_NEW_STAND, which must be usable as leg 0.
    const result = await planJourney(db, {
      origin: 'TIRUPUR_OLD_STAND',
      destination: 'MADURAI_STAND',
      departAfter: '2026-08-16T18:00:00',
      maxLegs: 1,
    });

    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['TPR_MDU_LAST']);
  });

  test('reports not found for an unreachable destination within maxLegs', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00',
      maxLegs: 2,
    });
    expect(result.found).toBe(false);
    expect(result.overallConfidence).toBeNull();
  });

  test('legs carry human-readable stop names and IST local times', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00',
    });

    const firstLeg = result.legs[0];
    expect(firstLeg.fromStopName).toBe('Ooty Bus Stand');
    expect(firstLeg.toStopName).toBe('Mettupalayam Bus Stand');
    expect(firstLeg.departureLocal).toBe('15:40');
    expect(firstLeg.arrivalLocal).toBe('17:10');
  });
});
