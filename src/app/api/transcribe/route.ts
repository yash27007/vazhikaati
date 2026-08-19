import { transcribe } from 'ai';
import { openai } from '@ai-sdk/openai';

const MOCK_TRANSCRIPT = 'When is the next bus from Ooty to Srivilliputhur tonight?';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('audio');
  const language = formData.get('language');
  const languageOverride = typeof language === 'string' && language.length > 0 ? language : undefined;

  if (!(file instanceof File)) {
    return Response.json({ error: 'No audio file was provided.' }, { status: 400 });
  }

  if (process.env.MOCK_LLM === 'true' && process.env.NODE_ENV !== 'production') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return Response.json({ text: MOCK_TRANSCRIPT, language: languageOverride ?? 'en' });
  }

  try {
    const audio = new Uint8Array(await file.arrayBuffer());
    const modelId = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe';
    const result = await transcribe({
      model: openai.transcription(modelId),
      audio,
      providerOptions: languageOverride ? { openai: { language: languageOverride } } : undefined,
    });
    return Response.json({ text: result.text, language: result.language });
  } catch (error) {
    console.error('Transcription failed:', error);
    return Response.json({ error: 'Could not transcribe that audio — please try again.' }, { status: 502 });
  }
}
