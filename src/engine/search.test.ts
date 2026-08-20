import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { agencies, calendars, stops, routes, trips, stopTimes } from '../db/schema';
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

  test('a same-trip continuation through an intermediate stop scores safe, not broken', async () => {
    // A single physical trip making 3 stops with only a 2-minute scheduled
    // halt at the middle one — shorter than any real transfer buffer.
    // Riding through that stop on the same bus isn't a transfer and must
    // not be penalized as a near-zero-buffer connection.
    await db.insert(agencies).values({ agencyId: 'MULTI', name: 'Multi-stop Test Agency', agencyType: 'informal', stateCode: 'TN', dataTier: 3 }).onConflictDoNothing();
    await db.insert(calendars).values({ serviceId: 'MULTI_DAILY', monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true, startDate: '2020-01-01', endDate: '2035-12-31' }).onConflictDoNothing();
    await db.insert(stops).values([
      { stopId: 'MULTI_A', name: 'Multi Stop A', stopType: 'terminus', townId: 'MULTI_A', dataTier: 3 },
      { stopId: 'MULTI_B', name: 'Multi Stop B', stopType: 'wayside', townId: 'MULTI_B', dataTier: 3 },
      { stopId: 'MULTI_C', name: 'Multi Stop C', stopType: 'terminus', townId: 'MULTI_C', dataTier: 3 },
    ]).onConflictDoNothing();
    await db.insert(routes).values({ routeId: 'MULTI-ROUTE', agencyId: 'MULTI', routeShortName: 'MX', routeLongName: 'A - C', routeType: 'ultra_deluxe' }).onConflictDoNothing();
    await db.insert(trips).values({ tripId: 'MULTI_TRIP', routeId: 'MULTI-ROUTE', serviceId: 'MULTI_DAILY', headsign: 'Multi Stop C', bookable: true, dataTier: 3 }).onConflictDoNothing();
    await db.insert(stopTimes).values([
      { tripId: 'MULTI_TRIP', stopSequence: 1, stopId: 'MULTI_A', arrivalMinutes: 600, departureMinutes: 600, haltMinutes: 0 },
      { tripId: 'MULTI_TRIP', stopSequence: 2, stopId: 'MULTI_B', arrivalMinutes: 650, departureMinutes: 652, haltMinutes: 2 },
      { tripId: 'MULTI_TRIP', stopSequence: 3, stopId: 'MULTI_C', arrivalMinutes: 700, departureMinutes: 700, haltMinutes: 0 },
    ]).onConflictDoNothing();

    const result = await planJourney(db, {
      origin: 'MULTI_A',
      destination: 'MULTI_C',
      departAfter: '2026-08-16T09:00:00',
    });

    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['MULTI_TRIP', 'MULTI_TRIP']);
    expect(result.legs[1].confidence).not.toBe('broken');
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
