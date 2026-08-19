import type { UIMessage } from 'ai';
import type { JourneyPlanResult } from '../../engine/types';
import type { LastSafeDepartureResult } from '../../engine/lastSafeDeparture';

export interface PlanToolOutput {
  plan: JourneyPlanResult | LastSafeDepartureResult | null;
  narration: string;
}

type MessagePart = UIMessage['parts'][number];

/**
 * Reads a plan_journey/find_last_safe_departure tool result out of a
 * streamed UI message part, if this part is one and its result has
 * arrived. Returns null for every other part (text, other tools, a
 * tool call still in progress).
 */
export function getPlanOutput(part: MessagePart): PlanToolOutput | null {
  if (part.type !== 'tool-plan_journey' && part.type !== 'tool-find_last_safe_departure') return null;
  if (!('state' in part) || part.state !== 'output-available') return null;
  if (!('output' in part) || part.output == null) return null;
  return part.output as PlanToolOutput;
}
