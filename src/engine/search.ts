import type { createDb } from '../db/client';
import { loadConnections } from './loadConnections';
import { earliestArrival } from './connectionScan';
import { scoreConfidence, getReliability } from './confidence';
import { inArray } from 'drizzle-orm';
import { stops } from '../db/schema';
import { resolveStopId, dateRangeFrom, worstBand, parseIstDateTime, formatIstTime } from './shared';
import type { Connection, TransferEdge, JourneyLeg, JourneyPlanResult } from './types';

export interface PlanJourneyInput {
  origin: string;
  destination: string;
  departAfter: string;
  maxLegs?: number;
  horizonDays?: number;
}

export async function planJourney(
  db: ReturnType<typeof createDb>,
  input: PlanJourneyInput,
): Promise<JourneyPlanResult> {
  const originStopId = await resolveStopId(db, input.origin);
  const destinationStopId = await resolveStopId(db, input.destination);
  const startAbsMin = parseIstDateTime(input.departAfter) / 60000;
  const dates = dateRangeFrom(input.departAfter, input.horizonDays ?? 3);

  const { connections, transferEdges } = await loadConnections(db, dates);
  const scan = earliestArrival(connections, transferEdges, originStopId, destinationStopId, startAbsMin, input.maxLegs ?? 4, 5);

  if (!scan.found) {
    return { found: false, legs: [], overallConfidence: null };
  }

  const legs = await buildLegsWithConfidence(scan.legs, connections, transferEdges, db);
  return { found: true, legs, overallConfidence: worstBand(legs.map((l) => l.confidence)) };
}

function minTransferRequired(transferEdges: TransferEdge[], fromStopId: string, toStopId: string): number {
  if (fromStopId === toStopId) return 5;
  const edge = transferEdges.find((t) => t.fromStopId === fromStopId && t.toStopId === toStopId);
  return edge?.minTransferMinutes ?? 0;
}

export async function buildLegsWithConfidence(
  scanLegs: Connection[],
  allConnections: Connection[],
  transferEdges: TransferEdge[],
  db: ReturnType<typeof createDb>,
): Promise<JourneyLeg[]> {
  const legs: JourneyLeg[] = [];

  const stopIds = new Set<string>();
  for (const leg of scanLegs) {
    stopIds.add(leg.fromStopId);
    stopIds.add(leg.toStopId);
  }
  const stopRows =
    stopIds.size > 0
      ? await db.select({ stopId: stops.stopId, name: stops.name }).from(stops).where(inArray(stops.stopId, [...stopIds]))
      : [];
  const stopNameById = new Map(stopRows.map((s) => [s.stopId, s.name]));

  for (let i = 0; i < scanLegs.length; i++) {
    const leg = scanLegs[i];
    const previous = i > 0 ? scanLegs[i - 1] : null;

    let transferBufferMinutes: number | null = null;
    if (previous) {
      const required = minTransferRequired(transferEdges, previous.toStopId, leg.fromStopId);
      transferBufferMinutes = leg.departureAbsMin - previous.arrivalAbsMin - required;
    }

    const sameOdPairLater = allConnections.filter(
      (c) => c.fromStopId === leg.fromStopId && c.toStopId === leg.toStopId && c.departureAbsMin > leg.departureAbsMin,
    );
    const isLastServiceOfDayForNextLeg = !sameOdPairLater.some(
      (c) => c.departureAbsMin < leg.departureAbsMin + 24 * 60,
    );
    const isDestinationReachableIfMissed = sameOdPairLater.length > 0;

    const reliability = await getReliability(db, leg.tripId);
    const { band, reasons } = scoreConfidence({
      transferBufferMinutes,
      isLastServiceOfDayForNextLeg,
      reliability,
      dataTier: leg.dataTier,
      isDestinationReachableIfMissed,
    });

    legs.push({
      tripId: leg.tripId,
      routeId: leg.routeId,
      fromStopId: leg.fromStopId,
      toStopId: leg.toStopId,
      fromStopName: stopNameById.get(leg.fromStopId) ?? leg.fromStopId,
      toStopName: stopNameById.get(leg.toStopId) ?? leg.toStopId,
      departureAbsMin: leg.departureAbsMin,
      arrivalAbsMin: leg.arrivalAbsMin,
      departureLocal: formatIstTime(leg.departureAbsMin),
      arrivalLocal: formatIstTime(leg.arrivalAbsMin),
      dataTier: leg.dataTier,
      confidence: band,
      confidenceReasons: reasons,
    });
  }

  return legs;
}
