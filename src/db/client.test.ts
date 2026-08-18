import { describe, test, expect } from 'bun:test';
import { sql } from 'drizzle-orm';
import { setupTestDb } from './testDb';

describe('test database connectivity', () => {
  const db = setupTestDb();

  test('can run a query against the test database', async () => {
    const result = await db.execute(sql`SELECT 1 AS ok`);
    expect(result.rows[0]).toEqual({ ok: 1 });
  });
});
