import type { Connection, TransferEdge } from './types';

export interface ScanResult {
  found: boolean;
  legs: Connection[];
}

interface Frontier {
  stopId: string;
  time: number;
  legs: number;
  path: Connection[];
}

/**
 * Earliest-arrival search bounded by maxLegs, over a small in-memory
 * connection list (a few hundred edges at most — this project's whole
 * point is that the network is small once it's actually written down).
 *
 * States are keyed by (stop, legsUsed) rather than just stop, so a
 * fewer-legs-but-later-arrival state is never discarded in favor of a
 * more-legs-but-earlier one — either might be the one that can still
 * reach the destination within maxLegs.
 */
export function earliestArrival(
  connections: Connection[],
  transferEdges: TransferEdge[],
  originStopId: string,
  destinationStopId: string,
  startAbsMin: number,
  maxLegs: number,
  defaultSameStopBufferMin: number,
): ScanResult {
  const byFromStop = new Map<string, Connection[]>();
  for (const c of connections) {
    const list = byFromStop.get(c.fromStopId) ?? [];
    list.push(c);
    byFromStop.set(c.fromStopId, list);
  }
  for (const list of byFromStop.values()) {
    list.sort((a, b) => a.departureAbsMin - b.departureAbsMin);
  }

  const transfersFrom = new Map<string, TransferEdge[]>();
  for (const t of transferEdges) {
    const list = transfersFrom.get(t.fromStopId) ?? [];
    list.push(t);
    transfersFrom.set(t.fromStopId, list);
  }

  function reachableDepartures(stopId: string, time: number, legs: number): Connection[] {
    const options: Connection[] = [];
    const sameStopBuffer = legs === 0 ? 0 : defaultSameStopBufferMin;
    for (const c of byFromStop.get(stopId) ?? []) {
      if (c.departureAbsMin >= time + sameStopBuffer) options.push(c);
    }
    if (legs > 0) {
      for (const t of transfersFrom.get(stopId) ?? []) {
        for (const c of byFromStop.get(t.toStopId) ?? []) {
          if (c.departureAbsMin >= time + t.minTransferMinutes) options.push(c);
        }
      }
    }
    return options;
  }

  const bestAtState = new Map<string, number>();
  const frontier: Frontier[] = [{ stopId: originStopId, time: startAbsMin, legs: 0, path: [] }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.time - b.time);
    const current = frontier.shift()!;

    if (current.stopId === destinationStopId && current.path.length > 0) {
      return { found: true, legs: current.path };
    }
    if (current.legs >= maxLegs) continue;

    const key = `${current.stopId}:${current.legs}`;
    const known = bestAtState.get(key);
    if (known !== undefined && known < current.time) continue;
    bestAtState.set(key, current.time);

    for (const connection of reachableDepartures(current.stopId, current.time, current.legs)) {
      const nextLegs = current.legs + 1;
      const nextKey = `${connection.toStopId}:${nextLegs}`;
      const bestKnown = bestAtState.get(nextKey);
      if (bestKnown !== undefined && bestKnown <= connection.arrivalAbsMin) continue;
      frontier.push({
        stopId: connection.toStopId,
        time: connection.arrivalAbsMin,
        legs: nextLegs,
        path: [...current.path, connection],
      });
    }
  }

  return { found: false, legs: [] };
}
