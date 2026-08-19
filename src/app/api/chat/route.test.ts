import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { setupTestDb, truncateAll } from '../../../db/testDb';
import { ingestDemoCorridor } from '../../../ingest/demoCorridor';

// The route handler imports the module-level `db` singleton from
// src/db/client.ts, which is bound to DATABASE_URL — a different connection
// than DATABASE_URL_TEST (used by setupTestDb()/truncateAll() below) unless
// some environment happens to alias the two, which isn't guaranteed anywhere
// (a fresh clone, CI, another developer's machine). Rather than depend on
// that, mock.module() substitutes the disposable test db as db/client's `db`
// export *before* route.ts (which transitively imports it) is loaded, so the
// route handler resolves to the exact same connection this file seeds via
// truncateAll()/ingestDemoCorridor() regardless of what DATABASE_URL is set
// to in the environment running the test.
//
// Static ES imports are hoisted above any other code, so a top-level
// `import { POST } from './route'` would already have pulled in the real
// db/client module before mock.module() got a chance to run. mock.module()
// must run first, then `./route` (and everything it imports) is pulled in
// via a dynamic import.
const db = setupTestDb();

mock.module('../../../db/client', () => ({ db }));

const { POST } = await import('./route');

describe('POST /api/chat (mock mode)', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
    process.env.MOCK_LLM = 'true';
  });

  test('a recognized demo query streams back the real demo-corridor plan', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { id: '1', role: 'user', parts: [{ type: 'text', text: 'How do I get from Ooty to Srivilliputhur?' }] },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const text = await response.text();
    // The SSE stream carries the tool's JSON-serialized output somewhere in
    // its body — check for the real, engine-produced tripId chain rather
    // than parsing the full SSE protocol.
    expect(text).toContain('OOTY_MTP_A');
    expect(text).toContain('MTP_TPR_A');
    expect(text).toContain('TPR_MDU_LAST');
    expect(text).toContain('MDU_SVP_LAST');
  });

  test('an unrecognized query gets the canned no-real-data reply, not a crash', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'What is the capital of France?' }] }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).toContain('mock_llm');
  });
});
