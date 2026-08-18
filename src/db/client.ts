import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';

export function createDb(connectionString: string) {
  return drizzle(connectionString);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const db = createDb(requireEnv('DATABASE_URL'));
