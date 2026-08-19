import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import type { createDb } from '../../../db/client';
import { createJourneyTools } from '../../../llm/tools';

// A fixed IST departure that reproduces the demo corridor's canonical worked
// example (OOTY_MTP_A -> MTP_TPR_A -> TPR_MDU_LAST -> MDU_SVP_LAST) — the
// same fixture datetime used throughout src/engine/search.test.ts.
const DEMO_DEPART_AFTER = '2026-08-16T15:00:00';

// The `prompt` doStream() receives is the FULL conversation history
// (LanguageModelV4Prompt = Array<LanguageModelV4Message>, each message
// { role: 'system' | 'user' | 'assistant' | 'tool', content: [...] } — see
// node_modules/@ai-sdk/provider/dist/index.d.ts), not just the newest turn.
// Scanning the whole thing for "ooty"/"srivilliputhur" means once a
// recognized query appears anywhere in a conversation, every later message
// in that same conversation would also match, even an unrelated follow-up
// like "what's the weather like?" — because the earlier turns are still
// sitting in the accumulated history. So we pull out only the latest
// `role: 'user'` message's text content and test that in isolation.
function latestUserMessageText(prompt: LanguageModelV4Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (message.role === 'user') {
      return message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ');
    }
  }
  return '';
}

function looksLikeDemoQuery(promptText: string): boolean {
  const lower = promptText.toLowerCase();
  return lower.includes('ooty') && (lower.includes('srivilliputhur') || lower.includes('svp'));
}

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
} as const;

/**
 * A ToolLoopAgent whose LANGUAGE MODEL is scripted (MockLanguageModelV4) but
 * whose TOOLS are the real createJourneyTools(db) — a recognized query
 * genuinely calls plan_journey against the real database's demo-corridor
 * data. This exercises the actual engine/tool wiring end to end without any
 * OpenAI call, for local verification with no API key. Only ONE tool call
 * is ever scripted (plan_journey) — this is a smoke test of the plumbing,
 * not a general-purpose fake LLM.
 */
export function createMockJourneyAgent(db: ReturnType<typeof createDb>) {
  let step = 0;
  const toolCallId = 'mock-tool-call-1';

  const model = new MockLanguageModelV4({
    modelId: 'mock-journey-model',
    doStream: async ({ prompt }) => {
      step += 1;
      const promptText = latestUserMessageText(prompt);

      if (step === 1 && looksLikeDemoQuery(promptText)) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId,
                toolName: 'plan_journey',
                input: JSON.stringify({
                  origin: 'Ooty',
                  destination: 'Srivilliputhur',
                  departAfter: DEMO_DEPART_AFTER,
                  maxLegs: 4,
                }),
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: ZERO_USAGE },
            ],
          }),
        };
      }

      if (step > 1) {
        // Follow-up step after the tool result came back — summarize in text.
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'summary' },
              { type: 'text-delta', id: 'summary', delta: 'Here is the demo journey plan (MOCK_LLM mode — no real model was called).' },
              { type: 'text-end', id: 'summary' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: ZERO_USAGE },
            ],
          }),
        };
      }

      // step === 1 and not a recognized query.
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'unrecognized' },
            {
              type: 'text-delta',
              id: 'unrecognized',
              delta:
                "MOCK_LLM is on — I only recognize a demo Ooty-to-Srivilliputhur query right now, not a live model. " +
                'Ask about travelling from Ooty to Srivilliputhur to see the real demo-corridor plan.',
            },
            { type: 'text-end', id: 'unrecognized' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: ZERO_USAGE },
          ],
        }),
      };
    },
  });

  return new ToolLoopAgent({
    model,
    instructions: 'Mock agent for local development — scripted responses only, see src/app/api/chat/mockAgent.ts.',
    tools: createJourneyTools(db),
  });
}
