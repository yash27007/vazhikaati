import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { createJourneyTools } from './tools';

describe('journey tools', () => {
  const db = setupTestDb();
  const tools = createJourneyTools(db);

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('plan_journey returns a structured plan and a narration, called directly as a function', async () => {
    const output = await tools.plan_journey.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', departAfter: '2026-08-16T15:00:00Z', maxLegs: 4 },
      { toolCallId: 'test', messages: [] } as any,
    );

    expect(output.plan.found).toBe(true);
    expect(output.plan.legs.map((l: any) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
    expect(typeof output.narration).toBe('string');
    expect(output.narration.length).toBeGreaterThan(0);
  });

  test('find_last_safe_departure returns the safe plan and a break explanation', async () => {
    const output = await tools.find_last_safe_departure.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', arriveBy: '2026-08-17T08:00:00Z', maxLegs: 4 },
      { toolCallId: 'test', messages: [] } as any,
    );

    expect(output.plan.found).toBe(true);
    expect(output.plan.breakExplanation).toContain('TIRUPUR_NEW_STAND');
    expect(output.narration).toContain('OOTY_MTP_A');
  });

  test('an unknown stop name returns a no-data response instead of throwing', async () => {
    const output = await tools.plan_journey.execute!(
      { origin: 'NOWHERE_MADE_UP', destination: 'SRIVILLIPUTHUR_STAND', departAfter: '2026-08-16T15:00:00Z', maxLegs: 4 },
      { toolCallId: 'test', messages: [] } as any,
    );
    expect(output.plan).toBeNull();
    expect(output.narration).toContain('NOWHERE_MADE_UP');
  });
});
