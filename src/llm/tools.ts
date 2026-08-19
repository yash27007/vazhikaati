import { z } from 'zod';
import { tool } from 'ai';
import type { createDb } from '../db/client';
import { planJourney } from '../engine/search';
import { findLastSafeDeparture } from '../engine/lastSafeDeparture';
import { StopNotFoundError } from '../engine/shared';
import type { JourneyPlanResult } from '../engine/types';
import type { LastSafeDepartureResult } from '../engine/lastSafeDeparture';

export function createJourneyTools(db: ReturnType<typeof createDb>) {
  return {
    plan_journey: tool({
      description: 'Find viable multi-leg bus journeys between two named stops, departing after a given time.',
      inputSchema: z.object({
        origin: z.string().describe('Origin stop name'),
        destination: z.string().describe('Destination stop name'),
        departAfter: z.string().describe('ISO 8601 datetime — do not depart before this'),
        maxLegs: z.number().int().min(1).max(6).default(4),
      }),
      execute: async ({ origin, destination, departAfter, maxLegs }) => {
        try {
          const plan = await planJourney(db, { origin, destination, departAfter, maxLegs });
          return { plan, narration: narratePlan(plan) };
        } catch (error) {
          if (error instanceof StopNotFoundError) {
            return { plan: null, narration: `I don't have "${error.query}" in the ledger yet.` };
          }
          throw error;
        }
      },
    }),
    find_last_safe_departure: tool({
      description: 'Given a required arrival time, return the latest departure that still arrives safely, plus why later options fail.',
      inputSchema: z.object({
        origin: z.string(),
        destination: z.string(),
        arriveBy: z.string().describe('ISO 8601 datetime — must arrive at or before this'),
        maxLegs: z.number().int().min(1).max(6).default(4),
      }),
      execute: async ({ origin, destination, arriveBy, maxLegs }) => {
        try {
          const plan = await findLastSafeDeparture(db, { origin, destination, arriveBy, maxLegs });
          return { plan, narration: narrateLastSafeDeparture(plan) };
        } catch (error) {
          if (error instanceof StopNotFoundError) {
            return { plan: null, narration: `I don't have "${error.query}" in the ledger yet.` };
          }
          throw error;
        }
      },
    }),
  };
}

function narratePlan(plan: JourneyPlanResult): string {
  if (!plan.found) return 'No route was found in the schedule for that request.';
  const steps = plan.legs.map((l) => `${l.tripId} from ${l.fromStopId} to ${l.toStopId}`).join(', then ');
  return `Take: ${steps}. Overall confidence: ${plan.overallConfidence}.`;
}

function narrateLastSafeDeparture(plan: LastSafeDepartureResult): string {
  if (!plan.found) return 'No journey in the schedule reaches the destination by that time.';
  const first = plan.legs[0];
  const base = `Last safe departure is ${first.tripId} from ${first.fromStopId}.`;
  return plan.breakExplanation ? `${base} ${plan.breakExplanation}` : base;
}
