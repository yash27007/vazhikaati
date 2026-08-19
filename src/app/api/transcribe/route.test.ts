import { describe, test, expect, beforeEach } from 'bun:test';
import { POST } from './route';

describe('POST /api/transcribe (mock mode)', () => {
  beforeEach(() => {
    process.env.MOCK_LLM = 'true';
  });

  test('returns a canned transcript without calling any transcription API', async () => {
    const formData = new FormData();
    formData.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'clip.webm');

    const request = new Request('http://localhost/api/transcribe', { method: 'POST', body: formData });
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
  });

  test('rejects a request with no audio field', async () => {
    const formData = new FormData();
    const request = new Request('http://localhost/api/transcribe', { method: 'POST', body: formData });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
