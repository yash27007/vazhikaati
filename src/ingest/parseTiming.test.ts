import { describe, test, expect } from 'bun:test';
import { parseDepartureTimings } from './parseTiming';

describe('parseDepartureTimings', () => {
  test('parses a plain HH.MM value', () => {
    expect(parseDepartureTimings('17.45')).toEqual([17 * 60 + 45]);
  });

  test('treats a bare integer as the top of the hour', () => {
    expect(parseDepartureTimings('21')).toEqual([21 * 60]);
  });

  test('right-pads a single trailing digit as tens of minutes', () => {
    // Spreadsheet export drops trailing zeros: "7.3" means 7:30, not 7:03.
    expect(parseDepartureTimings('7.3')).toEqual([7 * 60 + 30]);
  });

  test('parses a comma-separated list with stray whitespace and a trailing comma', () => {
    expect(parseDepartureTimings('07.15,19.30,20.00,20.30,21.30, 22.00,22.30,')).toEqual([
      7 * 60 + 15,
      19 * 60 + 30,
      20 * 60,
      20 * 60 + 30,
      21 * 60 + 30,
      22 * 60,
      22 * 60 + 30,
    ]);
  });

  test('throws on an invalid hour', () => {
    expect(() => parseDepartureTimings('25.00')).toThrow();
  });

  test('throws on an invalid minute', () => {
    expect(() => parseDepartureTimings('10.75')).toThrow();
  });

  test('throws on unparseable text', () => {
    expect(() => parseDepartureTimings('abc')).toThrow();
  });
});
