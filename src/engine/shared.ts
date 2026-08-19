import { eq, ilike } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { stops } from '../db/schema';
import type { ConfidenceBand } from './types';

export class StopNotFoundError extends Error {
  constructor(public readonly query: string) {
    super(`No stop found matching "${query}"`);
  }
}

function slugify(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function resolveStopId(db: ReturnType<typeof createDb>, query: string): Promise<string> {
  const normalized = query.trim();

  const bySlug = await db.select().from(stops).where(eq(stops.stopId, slugify(normalized))).limit(1);
  if (bySlug.length > 0) return bySlug[0].stopId;

  const byName = await db.select().from(stops).where(ilike(stops.name, normalized)).limit(1);
  if (byName.length > 0) return byName[0].stopId;

  // Fallback: substring match against the stored name, so a plain town/stop
  // name like "Ooty" resolves to "Ooty Bus Stand". When multiple stops
  // match, pick deterministically: shortest name first (most specific
  // match), then alphabetically.
  const bySubstring = await db.select().from(stops).where(ilike(stops.name, `%${normalized}%`));
  if (bySubstring.length > 0) {
    const [best] = bySubstring.sort(
      (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name),
    );
    return best.stopId;
  }

  throw new StopNotFoundError(query);
}

/** Minutes to add to a UTC instant to get its IST (Asia/Kolkata, UTC+5:30) wall-clock reading. */
export const IST_OFFSET_MINUTES = 330;

function hasExplicitOffset(isoDateTime: string): boolean {
  return /(Z|[+-]\d{2}:\d{2})$/.test(isoDateTime.trim());
}

/**
 * Parses an ISO 8601 datetime as IST when it carries no explicit timezone
 * offset. This project has one timezone that matters — it's an India bus
 * ledger — so an unqualified caller-supplied time (`departAfter`, `arriveBy`)
 * means IST, not whatever timezone the Node/Bun process happens to run in.
 * A string with an explicit offset (`Z`, `+05:30`, etc.) is respected as-is.
 * Returns the same thing `Date.parse` does: epoch milliseconds, or `NaN` for
 * an unparseable string.
 */
export function parseIstDateTime(isoDateTime: string): number {
  return Date.parse(hasExplicitOffset(isoDateTime) ? isoDateTime : `${isoDateTime}+05:30`);
}

/** Returns the `YYYY-MM-DD` IST calendar date an absolute-minute value falls on. */
export function istCalendarDate(absMin: number): string {
  return new Date((absMin + IST_OFFSET_MINUTES) * 60000).toISOString().slice(0, 10);
}

/** Renders an absolute-minute value as an `HH:MM` IST wall-clock time. */
export function formatIstTime(absMin: number): string {
  const ist = new Date((absMin + IST_OFFSET_MINUTES) * 60000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Renders an absolute-minute value as `YYYY-MM-DD HH:MM IST`, for messages spanning multiple days. */
export function formatIstDateTime(absMin: number): string {
  return `${istCalendarDate(absMin)} ${formatIstTime(absMin)} IST`;
}

/**
 * Returns an inclusive array of YYYY-MM-DD date strings.
 * days > 0: from the reference date's day forward through +days.
 * days < 0: from -|days| before the reference date's day through the reference day itself.
 */
export function dateRangeFrom(isoDateTime: string, days: number): string[] {
  const instantMs = parseIstDateTime(isoDateTime);
  const istInstant = new Date(instantMs + IST_OFFSET_MINUTES * 60000);
  const startDate = new Date(Date.UTC(istInstant.getUTCFullYear(), istInstant.getUTCMonth(), istInstant.getUTCDate()));
  const lowerBound = days < 0 ? -Math.abs(days) : 0;
  const upperBound = days < 0 ? 0 : days;
  const dates: string[] = [];
  for (let offset = lowerBound; offset <= upperBound; offset++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + offset);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const BAND_ORDER: ConfidenceBand[] = ['safe', 'tight', 'risky', 'broken'];

export function worstBand(bands: ConfidenceBand[]): ConfidenceBand {
  return bands.reduce(
    (worst, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(worst) ? b : worst),
    'safe' as ConfidenceBand,
  );
}
