import { eq } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { stops } from '../db/schema';
import { loadConnections } from './loadConnections';
import { earliestArrival } from './connectionScan';
import { buildLegsWithConfidence } from './search';
import { resolveStopId, dateRangeFrom, worstBand } from './shared';
import type { Connection, TransferEdge, JourneyLeg, ConfidenceBand } from './types';

export interface FindLastSafeDepartureInput {
  origin: string;
  destination: string;
  arriveBy: string;
  maxLegs?: number;
  horizonDays?: number;
}

export interface LastSafeDepartureResult {
  found: boolean;
  legs: JourneyLeg[];
  overallConfidence: ConfidenceBand | null;
  breakExplanation: string | null;
}

// Comfortably larger than any realistic absolute-minute value so reversal never
// produces a negative number in this project's lifetime.
const REVERSAL_ANCHOR = 10_000_000_000;

// A wait this long or longer, at a stop that isn't marked safe overnight,
// disqualifies a candidate departure — it's "feasible" but not "safe".
const UNSAFE_WAIT_THRESHOLD_MINUTES = 180;
const MAX_SAFETY_RETRIES = 10;

function reverseConnection(c: Connection): Connection {
  return {
    ...c,
    fromStopId: c.toStopId,
    toStopId: c.fromStopId,
    departureAbsMin: REVERSAL_ANCHOR - c.arrivalAbsMin,
    arrivalAbsMin: REVERSAL_ANCHOR - c.departureAbsMin,
  };
}

function reverseTransfer(t: TransferEdge): TransferEdge {
  return { fromStopId: t.toStopId, toStopId: t.fromStopId, minTransferMinutes: t.minTransferMinutes };
}

async function isUnsafeOvernightWait(
  db: ReturnType<typeof createDb>,
  stopId: string,
  waitMinutes: number,
): Promise<boolean> {
  if (waitMinutes < UNSAFE_WAIT_THRESHOLD_MINUTES) return false;
  const [stop] = await db.select().from(stops).where(eq(stops.stopId, stopId));
  return stop?.safeOvernight !== true;
}

/**
 * Finds the trip that requires an unsafe overnight wait to catch, if any.
 *
 * DEVIATION FROM THE BRIEF: the brief's version returned a boolean and, on
 * finding unsafe stranding, always excluded `forwardLegs[0].tripId` (the
 * origin leg). That assumes the stranding is always caused by the origin
 * departure, which isn't true in general — on this demo corridor the unsafe
 * wait is at TIRUPUR_NEW_STAND, between MTP_TPR_B and TPR_MDU_EARLY, two
 * legs downstream of the origin. Excluding the (innocent) origin leg on
 * each retry never removes the offending connection, so the retry loop
 * exhausts every origin departure and returns not-found — verified by
 * instrumenting the literal brief code: it excludes OOTY_MTP_B, then
 * OOTY_MTP_A, then OOTY_MTP_EARLY in turn, still reattaching the same
 * MTP_TPR_B -> TPR_MDU_EARLY tail each time, and fails all three retries.
 * Returning the *offending* trip (the one you'd have to wait unsafely to
 * catch) and excluding that instead — globally, not just from the origin —
 * lets the retry converge on OOTY_MTP_A / MTP_TPR_A / TPR_MDU_LAST /
 * MDU_SVP_LAST as the brief's own test expects. See task-10-report.md for
 * the full trace.
 */
async function findUnsafeStrandingTripId(
  db: ReturnType<typeof createDb>,
  legs: Connection[],
): Promise<string | null> {
  for (let i = 0; i < legs.length - 1; i++) {
    const waitMinutes = legs[i + 1].departureAbsMin - legs[i].arrivalAbsMin;
    // The wait is spent at the boarding stop of the next leg (after any
    // cross-stand transfer is done), not the alighting stop of this one.
    if (await isUnsafeOvernightWait(db, legs[i + 1].fromStopId, waitMinutes)) {
      return legs[i + 1].tripId;
    }
  }
  return null;
}

export async function findLastSafeDeparture(
  db: ReturnType<typeof createDb>,
  input: FindLastSafeDepartureInput,
): Promise<LastSafeDepartureResult> {
  const originStopId = await resolveStopId(db, input.origin);
  const destinationStopId = await resolveStopId(db, input.destination);
  const deadlineAbsMin = Date.parse(input.arriveBy) / 60000;
  const dates = dateRangeFrom(input.arriveBy, -(input.horizonDays ?? 3));

  const { connections, transferEdges } = await loadConnections(db, dates);
  // Exclusion is by bare tripId, not (tripId, date): on this project's
  // uniform daily-repeating demo calendar every occurrence of a trip behaves
  // identically, so this is harmless. Against a calendar with day-of-week
  // variation or exceptions, excluding a trip for one unsafe occurrence would
  // also remove its other, unrelated occurrences from the search window —
  // revisit if/when a non-uniform real corridor exercises this path.
  const excludedTripIds = new Set<string>();

  for (let attempt = 0; attempt < MAX_SAFETY_RETRIES; attempt++) {
    // Global exclusion by tripId (not scoped to the origin stop) — see the
    // deviation note on findUnsafeStrandingTripId for why.
    const candidateConnections = connections.filter((c) => !excludedTripIds.has(c.tripId));

    const reversedConnections = candidateConnections.map(reverseConnection);
    const reversedTransfers = transferEdges.map(reverseTransfer);
    const reversedStart = REVERSAL_ANCHOR - deadlineAbsMin;

    const scan = earliestArrival(
      reversedConnections,
      reversedTransfers,
      destinationStopId,
      originStopId,
      reversedStart,
      input.maxLegs ?? 4,
      5,
    );

    if (!scan.found) {
      return { found: false, legs: [], overallConfidence: null, breakExplanation: null };
    }

    // Reversing twice restores original direction and time; reversing the
    // array order un-does the "closest leg to destination first" traversal
    // order the backward scan naturally produces.
    const forwardLegs = scan.legs.map(reverseConnection).reverse();

    const strandingTripId = await findUnsafeStrandingTripId(db, forwardLegs);
    if (strandingTripId !== null) {
      excludedTripIds.add(strandingTripId);
      continue;
    }

    const legs = await buildLegsWithConfidence(forwardLegs, connections, transferEdges, db);
    const breakExplanation = await explainWhyLaterDeparturesFail(db, connections, transferEdges, forwardLegs);

    return {
      found: true,
      legs,
      overallConfidence: worstBand(legs.map((l) => l.confidence)),
      breakExplanation,
    };
  }

  // Retry exhaustion (10 candidates all struck unsafe) is indistinguishable
  // here from "no chain reaches the destination by the deadline at all" —
  // both return found:false with no explanation. On this project's small
  // demo corridor that's never been observed; a real corridor with many
  // routes could in principle need more than MAX_SAFETY_RETRIES exclusions
  // to converge on a genuinely safe chain, in which case this would
  // under-report rather than correctly say "search gave up." Revisit if a
  // real-data test ever exercises this branch.
  return { found: false, legs: [], overallConfidence: null, breakExplanation: null };
}

/**
 * Finds the next real departure from the origin after the safe one, and
 * replays the same stop sequence forward to find exactly where it breaks —
 * either no connection exists at all, or one exists but only after an
 * unsafe overnight wait.
 */
async function explainWhyLaterDeparturesFail(
  db: ReturnType<typeof createDb>,
  connections: Connection[],
  transferEdges: TransferEdge[],
  safeLegs: Connection[],
): Promise<string | null> {
  const firstLeg = safeLegs[0];
  const nextDeparture = connections
    .filter((c) => c.fromStopId === firstLeg.fromStopId && c.toStopId === firstLeg.toStopId)
    .filter((c) => c.departureAbsMin > firstLeg.departureAbsMin)
    .sort((a, b) => a.departureAbsMin - b.departureAbsMin)[0];
  if (!nextDeparture) return null;

  let arrivalAtCurrentStop = nextDeparture.arrivalAbsMin;
  let currentStopId = nextDeparture.toStopId;

  for (let i = 1; i < safeLegs.length; i++) {
    const requiredLeg = safeLegs[i];
    const buffer =
      currentStopId === requiredLeg.fromStopId
        ? 5
        : (transferEdges.find((t) => t.fromStopId === currentStopId && t.toStopId === requiredLeg.fromStopId)
            ?.minTransferMinutes ?? Infinity);

    const nextOnCorridor = connections
      .filter((c) => c.fromStopId === requiredLeg.fromStopId && c.toStopId === requiredLeg.toStopId)
      .filter((c) => c.departureAbsMin >= arrivalAtCurrentStop + buffer)
      .sort((a, b) => a.departureAbsMin - b.departureAbsMin)[0];

    const waitMinutes = nextOnCorridor ? nextOnCorridor.departureAbsMin - arrivalAtCurrentStop : null;
    const strandedHere =
      !nextOnCorridor ||
      (waitMinutes !== null && (await isUnsafeOvernightWait(db, requiredLeg.fromStopId, waitMinutes)));

    if (strandedHere) {
      const nextText = nextOnCorridor
        ? `the next connection from there doesn't depart until ${formatAbsMin(nextOnCorridor.departureAbsMin)}`
        : 'no further connection was found in the search window';
      return `Leaving after ${formatAbsMin(firstLeg.departureAbsMin)} instead: you would reach ${currentStopId} at ${formatAbsMin(arrivalAtCurrentStop)}, too late for the ${formatAbsMin(requiredLeg.departureAbsMin)} connection from ${requiredLeg.fromStopId} — ${nextText}.`;
    }

    arrivalAtCurrentStop = nextOnCorridor!.arrivalAbsMin;
    currentStopId = nextOnCorridor!.toStopId;
  }

  return null;
}

function formatAbsMin(absMin: number): string {
  return new Date(absMin * 60000).toISOString();
}
