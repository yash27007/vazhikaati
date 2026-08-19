import { describe, test, expect } from 'bun:test';
import { createDb } from '../db/client';
import { createJourneyAgent } from './agent';

describe('createJourneyAgent', () => {
  test('throws a clear error when OPENAI_API_KEY is not set', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => createJourneyAgent(createDb('postgresql://unused'))).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test('constructs successfully once a key is present (no live call is made)', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
    try {
      expect(() => createJourneyAgent(createDb('postgresql://unused'))).not.toThrow();
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });
});
