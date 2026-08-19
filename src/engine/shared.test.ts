import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { resolveStopId, StopNotFoundError } from './shared';

describe('resolveStopId', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('resolves an exact stop ID', async () => {
    expect(await resolveStopId(db, 'OOTY_STAND')).toBe('OOTY_STAND');
  });

  test('resolves an exact (case-insensitive) full stop name', async () => {
    expect(await resolveStopId(db, 'ooty bus stand')).toBe('OOTY_STAND');
  });

  test('resolves a plain town/stop name via substring match', async () => {
    // "Ooty" is a substring of the demo corridor's "Ooty Bus Stand" — this
    // is the shape of query an LLM tool caller actually sends.
    expect(await resolveStopId(db, 'Ooty')).toBe('OOTY_STAND');
  });

  test('throws StopNotFoundError for a query matching nothing', async () => {
    await expect(resolveStopId(db, 'Nowhereville')).rejects.toBeInstanceOf(StopNotFoundError);
  });
});
