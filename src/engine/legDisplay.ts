import type { JourneyLeg, ConfidenceBand } from './types';

const BAND_ORDER: ConfidenceBand[] = ['safe', 'tight', 'risky', 'broken'];

function worseBand(a: ConfidenceBand, b: ConfidenceBand): ConfidenceBand {
  return BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(a) ? b : a;
}

export interface DisplayLeg extends JourneyLeg {
  /** Names of intermediate stops this bus actually passes through between
   * fromStopName and toStopName, in order — empty for a single-hop leg. */
  viaStopNames: string[];
}

/**
 * Collapses consecutive legs that are actually the same physical bus trip
 * (same tripId) into one display leg — a passenger riding one bus through
 * several intermediate stops made one journey decision, not one per stop,
 * and showing every stop as its own card row misrepresents a single ride
 * as a chain of transfers. The intermediate stops aren't discarded, though
 * — they're the difference between "a bus" and "which bus, going where" —
 * so they're kept as viaStopNames for display.
 *
 * Display-only: this never changes the underlying JourneyLeg[] the engine
 * returns, or anything a test asserts against — it's applied at the point
 * a plan is shown to a person (the chat UI's JourneyPlanCard, and the LLM
 * tools' narration text), not inside planJourney/findLastSafeDeparture
 * themselves. Deliberately dependency-free (only the JourneyLeg/
 * ConfidenceBand types) so it's safe to import from a client component
 * without pulling engine/db code into the browser bundle.
 */
export function mergeSameTripLegsForDisplay(legs: JourneyLeg[]): DisplayLeg[] {
  const merged: DisplayLeg[] = [];
  for (const leg of legs) {
    const last = merged[merged.length - 1];
    if (last && last.tripId === leg.tripId) {
      // The stop we were about to call the destination is actually just
      // where this bus stopped along the way — record it before moving on.
      last.viaStopNames.push(last.toStopName);
      last.toStopId = leg.toStopId;
      last.toStopName = leg.toStopName;
      last.arrivalAbsMin = leg.arrivalAbsMin;
      last.arrivalLocal = leg.arrivalLocal;
      last.confidence = worseBand(last.confidence, leg.confidence);
      for (const reason of leg.confidenceReasons) {
        if (!last.confidenceReasons.includes(reason)) last.confidenceReasons.push(reason);
      }
    } else {
      merged.push({ ...leg, confidenceReasons: [...leg.confidenceReasons], viaStopNames: [] });
    }
  }
  return merged;
}
