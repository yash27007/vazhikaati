import { execFileSync } from 'node:child_process';
import { createDb } from './client';

function requireTestUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set — copy .env.example to .env first.',
    );
  }
  return url;
}

/** Pushes the current Drizzle schema onto the test database and returns a fresh client. */
export function setupTestDb() {
  const url = requireTestUrl();
  execFileSync('bunx', ['drizzle-kit', 'push', '--force'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: url,
    },
  });
  return createDb(url);
}
