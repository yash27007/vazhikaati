import { createAgentUIStreamResponse } from 'ai';
import { db } from '../../../db/client';
import { createJourneyAgent } from '../../../llm/agent';
import { createMockJourneyAgent } from './mockAgent';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong while responding — please try again.';
}

export async function POST(request: Request) {
  let messages: unknown[];
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.messages)) {
      return Response.json({ error: 'Request body must include a "messages" array.' }, { status: 400 });
    }
    messages = body.messages;
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const useMock = process.env.MOCK_LLM === 'true' && process.env.NODE_ENV !== 'production';

  try {
    const agent = useMock ? createMockJourneyAgent(db) : createJourneyAgent(db);
    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      onError: errorMessage,
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
