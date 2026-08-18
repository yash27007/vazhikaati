/**
 * Parses the SETC CSV "Departure Timings" cell into minutes-past-midnight.
 *
 * The source data encodes clock time as HH.MM (e.g. "17.45" = 17:45), but
 * the spreadsheet export has dropped trailing zeros from the minute part,
 * so a single trailing digit means tens of minutes, not units — "7.3" is
 * 7:30, not 7:03 (confirmed by cross-checking against reverse-direction
 * entries for the same corridor that use the full two-digit form). A bare
 * integer with no "." means the top of the hour ("21" = 21:00).
 *
 * A cell can hold multiple comma-separated departures, sometimes with a
 * trailing comma and stray whitespace ("07.15,19.30,20.00, 22.00,").
 */
export function parseDepartureTimings(raw: string): number[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseSingleTiming);
}

function parseSingleTiming(entry: string): number {
  const [hourPart, minutePart] = entry.split('.');
  const hour = Number.parseInt(hourPart, 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid hour in timing "${entry}"`);
  }

  let minute = 0;
  if (minutePart !== undefined) {
    if (!/^\d{1,2}$/.test(minutePart)) {
      throw new Error(`Invalid minute in timing "${entry}"`);
    }
    const padded = minutePart.length === 1 ? `${minutePart}0` : minutePart;
    minute = Number.parseInt(padded, 10);
    if (minute < 0 || minute > 59) {
      throw new Error(`Invalid minute in timing "${entry}"`);
    }
  }

  return hour * 60 + minute;
}
