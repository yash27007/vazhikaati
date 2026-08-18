export type ConfidenceBand = 'safe' | 'tight' | 'risky' | 'broken';

export interface Connection {
  tripId: string;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  /** Absolute minutes since the Unix epoch (UTC) — comparable across dates. */
  departureAbsMin: number;
  arrivalAbsMin: number;
  dataTier: number;
}

export interface TransferEdge {
  fromStopId: string;
  toStopId: string;
  minTransferMinutes: number;
}

export interface JourneyLeg {
  tripId: string;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  departureAbsMin: number;
  arrivalAbsMin: number;
  dataTier: number;
  confidence: ConfidenceBand;
  confidenceReasons: string[];
}

export interface JourneyPlanResult {
  found: boolean;
  legs: JourneyLeg[];
  overallConfidence: ConfidenceBand | null;
}
