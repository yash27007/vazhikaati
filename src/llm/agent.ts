import { ToolLoopAgent } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { createDb } from '../db/client';
import { createJourneyTools } from './tools';

const SYSTEM_PROMPT = `You are VazhiKaatti, a journey-planning assistant for Indian intercity bus travel.

Rules you must never break:
- You may only state a schedule fact (a time, a stop, a confidence level) if it came from a tool result in this conversation. If no tool returned the data, say so plainly and suggest the nearest thing you do know — never estimate or invent a timing.
- Reply in whatever language or mix of languages the user wrote in (Tamil, English, or code-mixed) — match them, don't force English.
- When a plan includes a "tight" or "risky" connection, say so plainly and explain why, using the tool's own confidence reasons — don't soften it.`;

function requireOpenAiKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. The journey engine and tools work without it (see src/engine ' +
        'and src/llm/tools.ts), but the conversational agent needs a key before it can run — set ' +
        'OPENAI_API_KEY in .env to enable it.',
    );
  }
}

export function createJourneyAgent(db: ReturnType<typeof createDb>) {
  requireOpenAiKey();
  return new ToolLoopAgent({
    model: openai(process.env.OPENAI_MODEL ?? 'gpt-5.5'),
    instructions: SYSTEM_PROMPT,
    tools: createJourneyTools(db),
  });
}
