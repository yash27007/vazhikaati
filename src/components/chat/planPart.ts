import type { UIMessage } from 'ai';
import type { JourneyPlanResult } from '../../engine/types';
import type { LastSafeDepartureResult } from '../../engine/lastSafeDeparture';

export interface PlanJourneyOutput {
  kind: 'plan_journey';
  options: JourneyPlanResult[] | null;
  narration: string;
}

export interface LastSafeDepartureOutput {
  kind: 'find_last_safe_departure';
  plan: LastSafeDepartureResult | null;
  narration: string;
}

export type PlanToolOutput = PlanJourneyOutput | LastSafeDepartureOutput;

type MessagePart = UIMessage['parts'][number];

/**
 * Reads a plan_journey/find_last_safe_departure tool result out of a
 * streamed UI message part, if this part is one and its result has
 * arrived. Returns null for every other part (text, other tools, a
 * tool call still in progress). The two tools have different output
 * shapes (plan_journey returns several `options`, find_last_safe_departure
 * returns one `plan`) — the returned union's `kind` field tells a caller
 * which it's looking at.
 */
export function getPlanOutput(part: MessagePart): PlanToolOutput | null {
  if (part.type !== 'tool-plan_journey' && part.type !== 'tool-find_last_safe_departure') return null;
  if (!('state' in part) || part.state !== 'output-available') return null;
  if (!('output' in part) || part.output == null) return null;

  if (part.type === 'tool-plan_journey') {
    const output = part.output as { options: JourneyPlanResult[] | null; narration: string };
    return { kind: 'plan_journey', options: output.options, narration: output.narration };
  }

  const output = part.output as { plan: LastSafeDepartureResult | null; narration: string };
  return { kind: 'find_last_safe_departure', plan: output.plan, narration: output.narration };
}

/** The found, renderable plans within a tool output, regardless of which tool produced it — 0, 1, or several. */
export function foundPlans(output: PlanToolOutput): (JourneyPlanResult | LastSafeDepartureResult)[] {
  if (output.kind === 'plan_journey') return (output.options ?? []).filter((p) => p.found);
  return output.plan?.found ? [output.plan] : [];
}
