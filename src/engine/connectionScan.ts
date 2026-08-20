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
  /** tripId of the connection that got us here, or null at the origin. */
  tripId: string | null;
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

  function reachableDepartures(stopId: string, time: number, legs: number, currentTripId: string | null): Connection[] {
    const options: Connection[] = [];
    for (const c of byFromStop.get(stopId) ?? []) {
      // Staying on the same physical trip you're already riding isn't a
      // transfer — only require the schedule's own halt to have elapsed,
      // not the default same-stand transfer buffer (which can easily
      // exceed a short scheduled halt and wrongly force you off your own
      // bus). Switching to any other trip still needs the full buffer.
      const isSameTrip = legs > 0 && c.tripId === currentTripId;
      const requiredGap = legs === 0 ? 0 : isSameTrip ? 0 : defaultSameStopBufferMin;
      if (c.departureAbsMin >= time + requiredGap) options.push(c);
    }
    // Transfer edges are allowed at leg 0 too: an origin-stand walk to a
    // different stand (e.g. Tirupur Old -> New) isn't a bus leg, so it
    // shouldn't be gated by "have we taken a bus yet".
    for (const t of transfersFrom.get(stopId) ?? []) {
      for (const c of byFromStop.get(t.toStopId) ?? []) {
        if (c.departureAbsMin >= time + t.minTransferMinutes) options.push(c);
      }
    }
    return options;
  }

  const bestAtState = new Map<string, number>();
  const frontier: Frontier[] = [{ stopId: originStopId, time: startAbsMin, legs: 0, path: [], tripId: null }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.time - b.time);
    const current = frontier.shift()!;

    if (current.stopId === destinationStopId && current.path.length > 0) {
      return { found: true, legs: current.path };
    }

    const key = `${current.stopId}:${current.legs}`;
    const known = bestAtState.get(key);
    if (known !== undefined && known < current.time) continue;
    bestAtState.set(key, current.time);

    for (const connection of reachableDepartures(current.stopId, current.time, current.legs, current.tripId)) {
      // Continuing on the same physical trip doesn't consume a "leg" — a
      // traveller riding one bus through several stops has made one
      // journey decision, not one per stop. maxLegs is only checked when
      // actually boarding a different trip.
      const isSameTrip = current.legs > 0 && connection.tripId === current.tripId;
      const nextLegs = isSameTrip ? current.legs : current.legs + 1;
      if (!isSameTrip && current.legs >= maxLegs) continue;

      const nextKey = `${connection.toStopId}:${nextLegs}`;
      const bestKnown = bestAtState.get(nextKey);
      if (bestKnown !== undefined && bestKnown <= connection.arrivalAbsMin) continue;
      frontier.push({
        stopId: connection.toStopId,
        time: connection.arrivalAbsMin,
        legs: nextLegs,
        path: [...current.path, connection],
        tripId: connection.tripId,
      });
    }
  }

  return { found: false, legs: [] };
}
