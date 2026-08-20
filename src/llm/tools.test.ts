import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { createJourneyTools, isoDateTimeString } from './tools';
import type { JourneyPlanResult } from '../engine/types';
import type { LastSafeDepartureResult } from '../engine/lastSafeDeparture';

// Minimal stand-in for the AI SDK's tool-call context argument (its second
// `execute` parameter), derived from the actual tool type rather than `any`
// so it stays correct if the SDK's context shape changes.
type ToolCallContext = Parameters<
  NonNullable<ReturnType<typeof createJourneyTools>['plan_journey']['execute']>
>[1];

const testToolCallContext: ToolCallContext = { toolCallId: 'test', messages: [], context: {} };

// `tool()`'s inferred `execute` return type is a union that also includes an
// `AsyncIterable<...>` streaming variant (from the AI SDK's generic `tool()`
// typing), even though these tools' `execute` functions only ever resolve to
// a plain object. Narrow to the concrete shape at each call site below,
// grounded in the actual `execute` implementations in `./tools`, not `any`.
type PlanJourneyOutput = { options: JourneyPlanResult[]; narration: string } | { options: null; narration: string };
type FindLastSafeDepartureOutput =
  | { plan: LastSafeDepartureResult; narration: string }
  | { plan: null; narration: string };

describe('journey tools', () => {
  const db = setupTestDb();
  const tools = createJourneyTools(db);

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('plan_journey returns multiple distinct options, earliest first, with narration', async () => {
    const output = (await tools.plan_journey.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', departAfter: '2026-08-16T15:00:00', maxLegs: 4 },
      testToolCallContext,
    )) as PlanJourneyOutput;

    if (!output.options) throw new Error('expected found options');
    expect(output.options.length).toBeGreaterThan(0);
    expect(output.options[0].found).toBe(true);
    expect(output.options[0].legs.map((l) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
    expect(typeof output.narration).toBe('string');
    expect(output.narration.length).toBeGreaterThan(0);
    expect(output.narration).toContain('Ooty Bus Stand');
    expect(output.narration).toContain('15:40');
  });

  test('plan_journey returns more than one option when more than one departure exists', async () => {
    // The demo corridor has 3 Ooty->Mettupalayam departures; asking from
    // 07:00 leaves all 3 (08:00, 15:40, 17:20) as candidates.
    const output = (await tools.plan_journey.execute!(
      { origin: 'OOTY_STAND', destination: 'MADURAI_STAND', departAfter: '2026-08-16T07:00:00', maxLegs: 4 },
      testToolCallContext,
    )) as PlanJourneyOutput;

    if (!output.options) throw new Error('expected found options');
    expect(output.options.length).toBeGreaterThan(1);
    expect(output.narration).toContain('Option 1:');
    expect(output.narration).toContain('Option 2:');
  });

  test('find_last_safe_departure returns the safe plan and a break explanation', async () => {
    const output = (await tools.find_last_safe_departure.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', arriveBy: '2026-08-17T08:00:00', maxLegs: 4 },
      testToolCallContext,
    )) as FindLastSafeDepartureOutput;

    if (!output.plan) throw new Error('expected a found plan');
    expect(output.plan.found).toBe(true);
    expect(output.plan.breakExplanation).toContain('Tirupur New Bus Stand');
    expect(output.narration).toContain('OOTY_MTP_A');
    expect(output.narration).toContain('Ooty Bus Stand');
  });

  test('an unknown stop name returns a no-data response instead of throwing', async () => {
    const output = (await tools.plan_journey.execute!(
      { origin: 'NOWHERE_MADE_UP', destination: 'SRIVILLIPUTHUR_STAND', departAfter: '2026-08-16T15:00:00Z', maxLegs: 4 },
      testToolCallContext,
    )) as PlanJourneyOutput;
    expect(output.options).toBeNull();
    expect(output.narration).toContain('NOWHERE_MADE_UP');
  });

  test('an unparseable datetime returns a no-plan response instead of throwing', async () => {
    const output = (await tools.plan_journey.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', departAfter: 'tomorrow 3pm', maxLegs: 4 },
      testToolCallContext,
    )) as PlanJourneyOutput;
    expect(output.options).toBeNull();
    expect(output.narration.length).toBeGreaterThan(0);
  });

  // isoDateTimeString must validate with the same parser the engine actually
  // uses (parseIstDateTime), not Date.parse — they disagree on a date-only
  // string like '2026-08-16', which Date.parse accepts but parseIstDateTime
  // (correctly) rejects once IST is appended to it.
  test('isoDateTimeString rejects a date-only string that parseIstDateTime cannot parse', () => {
    expect(isoDateTimeString.safeParse('2026-08-16').success).toBe(false);
  });

  test('isoDateTimeString accepts a full ISO datetime, with or without an explicit offset', () => {
    expect(isoDateTimeString.safeParse('2026-08-16T15:00:00').success).toBe(true);
    expect(isoDateTimeString.safeParse('2026-08-16T15:00:00Z').success).toBe(true);
    expect(isoDateTimeString.safeParse('2026-08-16T15:00:00+05:30').success).toBe(true);
  });
});
