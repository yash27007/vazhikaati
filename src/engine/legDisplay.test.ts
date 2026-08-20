import { describe, test, expect } from 'bun:test';
import { mergeSameTripLegsForDisplay } from './legDisplay';
import type { JourneyLeg } from './types';

function leg(partial: Partial<JourneyLeg> & Pick<JourneyLeg, 'tripId' | 'fromStopId' | 'toStopId'>): JourneyLeg {
  return {
    routeId: 'R1',
    fromStopName: partial.fromStopId,
    toStopName: partial.toStopId,
    departureAbsMin: 0,
    arrivalAbsMin: 0,
    departureLocal: '00:00',
    arrivalLocal: '00:00',
    dataTier: 1,
    confidence: 'safe',
    confidenceReasons: [],
    ...partial,
  };
}

describe('mergeSameTripLegsForDisplay', () => {
  test('collapses consecutive same-trip legs into one', () => {
    const legs: JourneyLeg[] = [
      leg({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureLocal: '06:00', arrivalLocal: '07:00' }),
      leg({ tripId: 'T1', fromStopId: 'B', toStopId: 'C', departureLocal: '07:05', arrivalLocal: '08:00' }),
      leg({ tripId: 'T1', fromStopId: 'C', toStopId: 'D', departureLocal: '08:05', arrivalLocal: '09:00' }),
    ];
    const merged = mergeSameTripLegsForDisplay(legs);
    expect(merged).toHaveLength(1);
    expect(merged[0].fromStopId).toBe('A');
    expect(merged[0].toStopId).toBe('D');
    expect(merged[0].departureLocal).toBe('06:00');
    expect(merged[0].arrivalLocal).toBe('09:00');
  });

  test('does not merge legs on different trips', () => {
    const legs: JourneyLeg[] = [
      leg({ tripId: 'T1', fromStopId: 'A', toStopId: 'B' }),
      leg({ tripId: 'T2', fromStopId: 'B', toStopId: 'C' }),
    ];
    expect(mergeSameTripLegsForDisplay(legs)).toHaveLength(2);
  });

  test('takes the worst confidence band across a merged run', () => {
    const legs: JourneyLeg[] = [
      leg({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', confidence: 'safe' }),
      leg({ tripId: 'T1', fromStopId: 'B', toStopId: 'C', confidence: 'risky' }),
      leg({ tripId: 'T1', fromStopId: 'C', toStopId: 'D', confidence: 'tight' }),
    ];
    expect(mergeSameTripLegsForDisplay(legs)[0].confidence).toBe('risky');
  });

  test('merges confidence reasons without duplicates', () => {
    const legs: JourneyLeg[] = [
      leg({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', confidenceReasons: ['reason 1'] }),
      leg({ tripId: 'T1', fromStopId: 'B', toStopId: 'C', confidenceReasons: ['reason 1', 'reason 2'] }),
    ];
    expect(mergeSameTripLegsForDisplay(legs)[0].confidenceReasons).toEqual(['reason 1', 'reason 2']);
  });

  test('leaves a single-leg or empty plan untouched', () => {
    expect(mergeSameTripLegsForDisplay([])).toEqual([]);
    const legs: JourneyLeg[] = [leg({ tripId: 'T1', fromStopId: 'A', toStopId: 'B' })];
    expect(mergeSameTripLegsForDisplay(legs)).toHaveLength(1);
  });
});
