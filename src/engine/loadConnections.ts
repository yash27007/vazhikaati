import type { createDb } from '../db/client';
import { calendars, calendarExceptions, trips, stopTimes, transfers } from '../db/schema';
import type { Connection, TransferEdge } from './types';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

interface CalendarRow {
  serviceId: string;
  monday: boolean | null;
  tuesday: boolean | null;
  wednesday: boolean | null;
  thursday: boolean | null;
  friday: boolean | null;
  saturday: boolean | null;
  sunday: boolean | null;
  startDate: string;
  endDate: string;
}

function isServiceActiveOn(
  calendar: CalendarRow,
  exceptions: { exceptionDate: string; exceptionType: number }[],
  dateStr: string,
): boolean {
  const exception = exceptions.find((e) => e.exceptionDate === dateStr);
  if (exception) return exception.exceptionType === 1;
  if (dateStr < calendar.startDate || dateStr > calendar.endDate) return false;
  const weekday = DAY_KEYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
  return calendar[weekday] === true;
}

function absoluteMinutes(dateStr: string, minutesPastMidnight: number): number {
  // IST (UTC+5:30) midnight of dateStr — see shared.ts for why this project
  // anchors every wall-clock time to IST, not UTC.
  return Date.parse(`${dateStr}T00:00:00+05:30`) / 60000 + minutesPastMidnight;
}

/**
 * Loads every stop_times leg of every trip whose calendar is active on any
 * of the given dates, expanded into concrete Connection instances anchored
 * to those dates, plus the full transfers table. Small enough (a few
 * hundred trips) to search entirely in memory.
 */
export async function loadConnections(
  db: ReturnType<typeof createDb>,
  dates: string[],
): Promise<{ connections: Connection[]; transferEdges: TransferEdge[] }> {
  const allTrips = await db
    .select({
      tripId: trips.tripId,
      routeId: trips.routeId,
      serviceId: trips.serviceId,
      dataTier: trips.dataTier,
    })
    .from(trips);
  const allCalendars = await db.select().from(calendars);
  const allExceptions = await db.select().from(calendarExceptions);
  const allStopTimes = await db
    .select()
    .from(stopTimes)
    .orderBy(stopTimes.tripId, stopTimes.stopSequence);
  const allTransfers = await db.select().from(transfers);

  const calendarById = new Map(allCalendars.map((c) => [c.serviceId, c as CalendarRow]));
  const exceptionsByService = new Map<string, typeof allExceptions>();
  for (const exception of allExceptions) {
    const list = exceptionsByService.get(exception.serviceId) ?? [];
    list.push(exception);
    exceptionsByService.set(exception.serviceId, list);
  }
  const stopTimesByTrip = new Map<string, typeof allStopTimes>();
  for (const st of allStopTimes) {
    const list = stopTimesByTrip.get(st.tripId) ?? [];
    list.push(st);
    stopTimesByTrip.set(st.tripId, list);
  }

  const connections: Connection[] = [];
  for (const trip of allTrips) {
    const calendar = calendarById.get(trip.serviceId);
    if (!calendar) continue;
    const exceptions = exceptionsByService.get(trip.serviceId) ?? [];
    const legs = (stopTimesByTrip.get(trip.tripId) ?? []).sort(
      (a, b) => a.stopSequence - b.stopSequence,
    );

    for (const date of dates) {
      if (!isServiceActiveOn(calendar, exceptions, date)) continue;
      for (let i = 0; i < legs.length - 1; i++) {
        connections.push({
          tripId: trip.tripId,
          routeId: trip.routeId,
          fromStopId: legs[i].stopId,
          toStopId: legs[i + 1].stopId,
          departureAbsMin: absoluteMinutes(date, legs[i].departureMinutes!),
          arrivalAbsMin: absoluteMinutes(date, legs[i + 1].arrivalMinutes!),
          dataTier: trip.dataTier ?? 2,
        });
      }
    }
  }

  const transferEdges: TransferEdge[] = allTransfers.map((t) => ({
    fromStopId: t.fromStopId,
    toStopId: t.toStopId,
    minTransferMinutes: t.minTransferMinutes,
  }));

  return { connections, transferEdges };
}
