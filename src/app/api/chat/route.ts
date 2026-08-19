import { createAgentUIStreamResponse } from 'ai';
import { db } from '../../../db/client';
import { createJourneyAgent } from '../../../llm/agent';
import { createMockJourneyAgent } from './mockAgent';

export async function POST(request: Request) {
  const { messages } = await request.json();

  const agent = process.env.MOCK_LLM === 'true' ? createMockJourneyAgent(db) : createJourneyAgent(db);

  return createAgentUIStreamResponse({ agent, uiMessages: messages });
}
