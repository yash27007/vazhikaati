import type { JourneyPlanResult } from '../../engine/types';
import type { LastSafeDepartureResult } from '../../engine/lastSafeDeparture';
import type { ConfidenceBand } from '../../engine/types';

const BAND_STYLES: Record<ConfidenceBand, string> = {
  safe: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  tight: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  risky: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  broken: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function ConfidenceBadge({ band }: { band: ConfidenceBand }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BAND_STYLES[band]}`}>{band}</span>;
}

export function JourneyPlanCard({ plan }: { plan: JourneyPlanResult | LastSafeDepartureResult }) {
  if (!plan.found) return null;

  const breakExplanation = 'breakExplanation' in plan ? plan.breakExplanation : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <ol className="flex flex-col gap-2">
        {plan.legs.map((leg, index) => (
          <li key={`${leg.tripId}-${index}`} className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">
                {leg.departureLocal} {leg.fromStopName} → {leg.arrivalLocal} {leg.toStopName}
              </div>
              <div className="text-xs text-zinc-500">{leg.tripId}</div>
            </div>
            <ConfidenceBadge band={leg.confidence} />
          </li>
        ))}
      </ol>
      {plan.overallConfidence && (
        <div className="mt-2 flex items-center gap-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-700">
          <span>Overall:</span>
          <ConfidenceBadge band={plan.overallConfidence} />
        </div>
      )}
      {breakExplanation && (
        <p className="mt-2 rounded-lg bg-orange-50 p-2 text-xs text-orange-800 dark:bg-orange-950 dark:text-orange-200">
          {breakExplanation}
        </p>
      )}
    </div>
  );
}
