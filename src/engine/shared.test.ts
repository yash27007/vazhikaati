import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { resolveStopId, StopNotFoundError, parseIstDateTime, istCalendarDate, formatIstTime, formatIstDateTime } from './shared';

describe('resolveStopId', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('resolves an exact stop ID', async () => {
    expect(await resolveStopId(db, 'OOTY_STAND')).toBe('OOTY_STAND');
  });

  test('resolves an exact (case-insensitive) full stop name', async () => {
    expect(await resolveStopId(db, 'ooty bus stand')).toBe('OOTY_STAND');
  });

  test('resolves a plain town/stop name via substring match', async () => {
    // "Ooty" is a substring of the demo corridor's "Ooty Bus Stand" — this
    // is the shape of query an LLM tool caller actually sends.
    expect(await resolveStopId(db, 'Ooty')).toBe('OOTY_STAND');
  });

  test('throws StopNotFoundError for a query matching nothing', async () => {
    await expect(resolveStopId(db, 'Nowhereville')).rejects.toBeInstanceOf(StopNotFoundError);
  });
});

describe('IST time helpers', () => {
  test('parseIstDateTime treats an offset-less datetime as IST (UTC+5:30)', () => {
    // 15:40 IST on 2026-08-16 is 10:10 UTC on the same calendar day.
    const ms = parseIstDateTime('2026-08-16T15:40:00');
    expect(new Date(ms).toISOString()).toBe('2026-08-16T10:10:00.000Z');
  });

  test('parseIstDateTime respects an explicit offset instead of overriding it', () => {
    const ms = parseIstDateTime('2026-08-16T15:40:00Z');
    expect(new Date(ms).toISOString()).toBe('2026-08-16T15:40:00.000Z');
  });

  test('istCalendarDate reports the IST calendar day, not the UTC day, for an early-morning instant', () => {
    // 2026-08-15T23:00:00Z is 2026-08-16T04:30:00 IST — an early-morning IST
    // departure that falls on the *previous* UTC calendar day.
    const absMin = Date.parse('2026-08-15T23:00:00Z') / 60000;
    expect(istCalendarDate(absMin)).toBe('2026-08-16');
  });

  test('formatIstTime renders HH:MM in IST regardless of the process timezone', () => {
    const absMin = parseIstDateTime('2026-08-16T15:40:00') / 60000;
    expect(formatIstTime(absMin)).toBe('15:40');
  });

  test('formatIstDateTime renders the IST calendar date alongside the time', () => {
    const absMin = parseIstDateTime('2026-08-16T15:40:00') / 60000;
    expect(formatIstDateTime(absMin)).toBe('2026-08-16 15:40 IST');
  });
});
