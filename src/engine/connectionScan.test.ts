import { describe, test, expect } from 'bun:test';
import { earliestArrival } from './connectionScan';
import type { Connection, TransferEdge } from './types';

function conn(partial: Partial<Connection> & Pick<Connection, 'tripId' | 'fromStopId' | 'toStopId' | 'departureAbsMin' | 'arrivalAbsMin'>): Connection {
  return { routeId: partial.tripId, dataTier: 1, ...partial };
}

describe('earliestArrival', () => {
  test('finds a direct connection', () => {
    const connections = [conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 })];
    const result = earliestArrival(connections, [], 'A', 'B', 90, 4, 5);
    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1']);
  });

  test('chains two legs respecting a minimum same-stop transfer buffer', () => {
    const connections = [
      conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 }),
      conn({ tripId: 'T2', fromStopId: 'B', toStopId: 'C', departureAbsMin: 153, arrivalAbsMin: 200 }), // only 3 min buffer
      conn({ tripId: 'T3', fromStopId: 'B', toStopId: 'C', departureAbsMin: 160, arrivalAbsMin: 210 }), // 10 min buffer
    ];
    const result = earliestArrival(connections, [], 'A', 'C', 90, 4, 5);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1', 'T3']); // T2 excluded — under the 5 min buffer
  });

  test('uses a transfer edge to reach a departure from a different stop in the same town', () => {
    const connections = [
      conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B_OLD', departureAbsMin: 100, arrivalAbsMin: 150 }),
      conn({ tripId: 'T2', fromStopId: 'B_NEW', toStopId: 'C', departureAbsMin: 165, arrivalAbsMin: 200 }),
    ];
    const transferEdges: TransferEdge[] = [{ fromStopId: 'B_OLD', toStopId: 'B_NEW', minTransferMinutes: 10 }];
    const result = earliestArrival(connections, transferEdges, 'A', 'C', 90, 4, 5);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1', 'T2']);
  });

  test('uses a transfer edge at the origin (before any bus leg) to reach the network', () => {
    // The origin stand only has a transfer edge out — no direct departures —
    // so the very first hop taken must be a transfer, at legs === 0.
    const connections = [conn({ tripId: 'T1', fromStopId: 'B_NEW', toStopId: 'C', departureAbsMin: 165, arrivalAbsMin: 200 })];
    const transferEdges: TransferEdge[] = [{ fromStopId: 'B_OLD', toStopId: 'B_NEW', minTransferMinutes: 10 }];
    const result = earliestArrival(connections, transferEdges, 'B_OLD', 'C', 90, 4, 5);
    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1']);
  });

  test('respects maxLegs', () => {
    const connections = [
      conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 }),
      conn({ tripId: 'T2', fromStopId: 'B', toStopId: 'C', departureAbsMin: 160, arrivalAbsMin: 210 }),
      conn({ tripId: 'T3', fromStopId: 'C', toStopId: 'D', departureAbsMin: 220, arrivalAbsMin: 260 }),
    ];
    expect(earliestArrival(connections, [], 'A', 'D', 90, 2, 5).found).toBe(false);
    expect(earliestArrival(connections, [], 'A', 'D', 90, 3, 5).found).toBe(true);
  });

  test('reports not found when no chain exists', () => {
    const connections = [conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 })];
    const result = earliestArrival(connections, [], 'A', 'Z', 90, 4, 5);
    expect(result.found).toBe(false);
    expect(result.legs).toEqual([]);
  });
});
