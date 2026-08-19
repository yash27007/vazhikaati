import { eq } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { tripReliability } from '../db/schema';
import type { ConfidenceBand } from './types';

export interface ConfidenceInput {
  /** Scheduled gap minus the minimum required transfer time. null for a journey's first leg. */
  transferBufferMinutes: number | null;
  isLastServiceOfDayForNextLeg: boolean;
  reliability: { sampleSize: number; onTimeRate: number } | null;
  dataTier: number;
  isDestinationReachableIfMissed: boolean;
}

export interface ConfidenceResult {
  band: ConfidenceBand;
  reasons: string[];
}

const UNRELIABLE_ON_TIME_RATE_THRESHOLD = 0.7;

/** Ordinal rank of each band, worst last, for comparing/capping bands. */
const BAND_RANK: Record<ConfidenceBand, number> = { safe: 0, tight: 1, risky: 2, broken: 3 };

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];

  if (!input.isDestinationReachableIfMissed) {
    reasons.push('this is the last service of the day for this connection — missing it means no fallback today');
  }

  if (input.reliability === null) {
    reasons.push('no reliability history yet for this leg — confidence is based on schedule structure only');
  }

  const unreliableInbound =
    input.reliability !== null && input.reliability.onTimeRate < UNRELIABLE_ON_TIME_RATE_THRESHOLD;
  if (unreliableInbound) {
    const latePercent = Math.round((1 - input.reliability!.onTimeRate) * 100);
    reasons.push(`this leg has run late in about ${latePercent}% of observed trips`);
  }

  let band: ConfidenceBand;

  if (input.transferBufferMinutes === null) {
    // No transfer to assess (this isn't a transfer leg), but the other
    // signals — unreliable inbound reliability and last-service-of-day —
    // must still be able to downgrade the band below "safe", mirroring the
    // same thresholds used below for legs with a real transfer buffer.
    if (input.isLastServiceOfDayForNextLeg) {
      band = 'risky';
    } else if (unreliableInbound) {
      band = 'tight';
    } else {
      band = 'safe';
    }
  } else if (input.transferBufferMinutes < 0) {
    reasons.push('the connecting service does not run after this leg arrives');
    band = 'broken';
  } else if (input.transferBufferMinutes < 20 || input.isLastServiceOfDayForNextLeg) {
    reasons.push(`only ${input.transferBufferMinutes} minutes of slack to make this connection`);
    band = 'risky';
  } else if (input.transferBufferMinutes < 45 || unreliableInbound) {
    reasons.push(`${input.transferBufferMinutes} minutes of slack to make this connection`);
    band = 'tight';
  } else {
    band = 'safe';
  }

  if (input.dataTier === 3 && BAND_RANK[band] < BAND_RANK.tight) {
    band = 'tight';
    reasons.push('this leg is hand-authored synthetic/unverified data (data tier 3) — treat the timing as unconfirmed');
  }

  return { band, reasons };
}

export async function getReliability(
  db: ReturnType<typeof createDb>,
  tripId: string,
): Promise<{ sampleSize: number; onTimeRate: number } | null> {
  const [row] = await db.select().from(tripReliability).where(eq(tripReliability.tripId, tripId));
  if (!row || !row.sampleSize || row.sampleSize <= 0 || row.onTimeRate === null) return null;
  return { sampleSize: row.sampleSize, onTimeRate: Number(row.onTimeRate) };
}
