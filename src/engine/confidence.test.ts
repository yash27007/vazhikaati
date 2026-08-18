import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { agencies, stops, routes, calendars, trips, tripReliability } from '../db/schema';
import { scoreConfidence, getReliability } from './confidence';

describe('scoreConfidence', () => {
  test('first leg of a journey is always safe (no incoming transfer to assess)', () => {
    const { band } = scoreConfidence({
      transferBufferMinutes: null,
      isLastServiceOfDayForNextLeg: false,
      reliability: null,
      dataTier: 1,
      isDestinationReachableIfMissed: true,
    });
    expect(band).toBe('safe');
  });

  test('bands by buffer per the spec thresholds', () => {
    expect(scoreConfidence({ transferBufferMinutes: 60, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('safe');
    expect(scoreConfidence({ transferBufferMinutes: 30, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('tight');
    expect(scoreConfidence({ transferBufferMinutes: 10, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('risky');
    expect(scoreConfidence({ transferBufferMinutes: -5, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('broken');
  });

  test('last service of the day forces risky even with a nominally comfortable buffer', () => {
    const { band, reasons } = scoreConfidence({
      transferBufferMinutes: 60,
      isLastServiceOfDayForNextLeg: true,
      reliability: null,
      dataTier: 1,
      isDestinationReachableIfMissed: false,
    });
    expect(band).toBe('risky');
    expect(reasons.some((r) => r.includes('last service'))).toBe(true);
  });

  test('never fabricates a reliability number — missing data is reported, not defaulted', () => {
    const { reasons } = scoreConfidence({
      transferBufferMinutes: 60,
      isLastServiceOfDayForNextLeg: false,
      reliability: null,
      dataTier: 1,
      isDestinationReachableIfMissed: true,
    });
    expect(reasons.some((r) => r.includes('no reliability history'))).toBe(true);
  });

  test('an unreliable inbound leg downgrades an otherwise-safe buffer to tight', () => {
    const { band } = scoreConfidence({
      transferBufferMinutes: 50,
      isLastServiceOfDayForNextLeg: false,
      reliability: { sampleSize: 20, onTimeRate: 0.5 },
      dataTier: 1,
      isDestinationReachableIfMissed: true,
    });
    expect(band).toBe('tight');
  });
});

describe('getReliability', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await db.insert(agencies).values({ agencyId: 'A', name: 'A', agencyType: 'division', stateCode: 'TN' });
    await db.insert(routes).values({ routeId: 'R', agencyId: 'A', routeType: 'ultra_deluxe' });
    await db.insert(calendars).values({
      serviceId: 'S', monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true, startDate: '2026-01-01', endDate: '2027-01-01',
    });
    await db.insert(trips).values([
      { tripId: 'HAS_DATA', routeId: 'R', serviceId: 'S' },
      { tripId: 'NO_DATA', routeId: 'R', serviceId: 'S' },
    ]);
    await db.insert(tripReliability).values({ tripId: 'HAS_DATA', sampleSize: 12, onTimeRate: '0.750' });
  });

  test('returns the observed rate when a reliability row with samples exists', async () => {
    const result = await getReliability(db, 'HAS_DATA');
    expect(result).toEqual({ sampleSize: 12, onTimeRate: 0.75 });
  });

  test('returns null when no row exists', async () => {
    expect(await getReliability(db, 'NO_DATA')).toBeNull();
  });

  test('returns null when a row exists but sample_size is 0', async () => {
    await db.insert(trips).values({ tripId: 'ZERO', routeId: 'R', serviceId: 'S' });
    await db.insert(tripReliability).values({ tripId: 'ZERO', sampleSize: 0, onTimeRate: '0.000' });
    expect(await getReliability(db, 'ZERO')).toBeNull();
  });
});
