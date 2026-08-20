import type { JourneyPlanResult } from '../../engine/types';
import type { LastSafeDepartureResult } from '../../engine/lastSafeDeparture';
import type { ConfidenceBand } from '../../engine/types';
import { mergeSameTripLegsForDisplay } from '../../engine/legDisplay';

const BAND_STYLES: Record<ConfidenceBand, string> = {
  safe: 'bg-band-safe-bg text-band-safe-ink',
  tight: 'bg-band-tight-bg text-band-tight-ink',
  risky: 'bg-band-risky-bg text-band-risky-ink',
  broken: 'bg-band-broken-bg text-band-broken-ink',
};

/* The rail down the left of each leg is the same colour as its badge, so
   the shape of the risk is visible before a single word is read. */
const RAIL_STYLES: Record<ConfidenceBand, string> = {
  safe: 'bg-band-safe',
  tight: 'bg-band-tight',
  risky: 'bg-band-risky',
  broken: 'bg-band-broken',
};

/* Colour is never the only signal: each badge also fills a four-pip meter,
   which survives both a red/green confusion and a dim screen at a bus stand. */
const BAND_PIPS: Record<ConfidenceBand, number> = {
  safe: 4,
  tight: 3,
  risky: 2,
  broken: 1,
};

function ConfidenceBadge({ band }: { band: ConfidenceBand }) {
  const filled = BAND_PIPS[band];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.08em] ${BAND_STYLES[band]}`}
    >
      <span aria-hidden="true" className="flex items-center gap-[2px]">
        {[0, 1, 2, 3].map((pip) => (
          <span
            key={pip}
            className={`h-2.5 w-[3px] rounded-[1px] bg-current ${pip < filled ? '' : 'opacity-25'}`}
          />
        ))}
      </span>
      {band}
    </span>
  );
}

export function JourneyPlanCard({ plan }: { plan: JourneyPlanResult | LastSafeDepartureResult }) {
  if (!plan.found) return null;

  const breakExplanation = 'breakExplanation' in plan ? plan.breakExplanation : null;
  const displayLegs = mergeSameTripLegsForDisplay(plan.legs);

  return (
    <div className="rounded-2xl border border-line bg-surface-sunken p-3 sm:p-4">
      <ol className="flex flex-col gap-4">
        {displayLegs.map((leg, index) => (
          <li key={`${leg.tripId}-${index}`} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-1 w-[3px] shrink-0 self-stretch rounded-full ${RAIL_STYLES[leg.confidence]}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-baseline gap-2.5">
                    <span className="tabular font-mono text-[0.8125rem] font-medium text-ink">
                      {leg.departureLocal}
                    </span>
                    <span className="truncate text-[0.875rem] leading-snug text-ink">
                      {leg.fromStopName}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="tabular font-mono text-[0.8125rem] font-medium text-ink">
                      {leg.arrivalLocal}
                    </span>
                    <span className="truncate text-[0.875rem] leading-snug text-ink">
                      {leg.toStopName}
                    </span>
                  </div>
                </div>
                <ConfidenceBadge band={leg.confidence} />
              </div>
              {leg.viaStopNames.length > 0 && (
                <div className="truncate text-[0.75rem] leading-snug text-ink-muted">
                  via {leg.viaStopNames.join(', ')}
                </div>
              )}
              <div className="tabular font-mono text-[0.6875rem] tracking-wide text-ink-faint">
                {leg.tripId}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {plan.overallConfidence && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-muted">
            Overall
          </span>
          <ConfidenceBadge band={plan.overallConfidence} />
        </div>
      )}
      {breakExplanation && (
        <p className="mt-3 rounded-xl bg-band-risky-bg px-3 py-2.5 text-[0.8125rem] leading-snug text-band-risky-ink">
          {breakExplanation}
        </p>
      )}
    </div>
  );
}
