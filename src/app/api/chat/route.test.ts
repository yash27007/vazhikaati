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

  // Regression test: looksLikeDemoQuery() used to scan the ENTIRE prompt
  // history (via JSON.stringify(prompt)), not just the latest user turn. So
  // once a recognized Ooty->Srivilliputhur query appeared anywhere in a
  // conversation, every later message in that same conversation — even an
  // unrelated follow-up — kept matching, because the earlier turn was still
  // sitting in the accumulated history. This sends a full 3-message
  // conversation (recognized query, assistant reply, unrelated follow-up) in
  // a single request, the way an existing conversation's history would
  // arrive on its next turn, and checks the follow-up gets the fallback
  // reply rather than re-triggering the demo plan-card tool-call.
  test('an unrelated follow-up in an existing conversation gets the fallback, not a re-triggered demo plan', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { id: '1', role: 'user', parts: [{ type: 'text', text: 'How do I get from Ooty to Srivilliputhur?' }] },
          {
            id: '2',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Here is the demo journey plan (MOCK_LLM mode — no real model was called).' }],
          },
          { id: '3', role: 'user', parts: [{ type: 'text', text: "what's the weather like?" }] },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).toContain('mock_llm');
    expect(text).not.toContain('OOTY_MTP_A');
  });

  // Real-mode failure path: with MOCK_LLM unset and OPENAI_API_KEY missing,
  // createJourneyAgent's requireOpenAiKey() throws synchronously before any
  // streaming starts. The route must catch that and return a structured
  // error response, not an unhandled 500 or a silent hang.
  test('missing OPENAI_API_KEY without MOCK_LLM returns a structured error, not a throw', async () => {
    const previousMockLlm = process.env.MOCK_LLM;
    const previousApiKey = process.env.OPENAI_API_KEY;
    delete process.env.MOCK_LLM;
    delete process.env.OPENAI_API_KEY;

    try {
      const request = new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(typeof body.error).toBe('string');
      expect(body.error).toContain('OPENAI_API_KEY');
    } finally {
      if (previousMockLlm === undefined) delete process.env.MOCK_LLM;
      else process.env.MOCK_LLM = previousMockLlm;
      if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousApiKey;
    }
  });
});
