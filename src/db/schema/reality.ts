import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  bigserial,
  date,
  numeric,
  timestamp,
  smallint,
  integer,
  check,
} from 'drizzle-orm/pg-core';
import { trips, stops } from './ledger';

export const vehiclePositions = pgTable(
  'vehicle_positions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tripId: text('trip_id').references(() => trips.tripId),
    serviceDate: date('service_date').notNull(),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lon: numeric('lon', { precision: 9, scale: 6 }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    source: text('source'),
    delayMinutes: smallint('delay_minutes'),
  },
  (table) => [
    check('vehicle_positions_source_check', sql`${table.source} IN ('gps','crowd','inferred')`),
  ],
);

export const tripObservations = pgTable(
  'trip_observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tripId: text('trip_id').references(() => trips.tripId),
    serviceDate: date('service_date').notNull(),
    stopId: text('stop_id').references(() => stops.stopId),
    observationType: text('observation_type'),
    observedMinutes: integer('observed_minutes'),
    reporterHash: text('reporter_hash'),
    confidenceWeight: numeric('confidence_weight', { precision: 3, scale: 2 }).default('1.0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      'trip_observations_type_check',
      sql`${table.observationType} IN ('ran','did_not_run','departed_at','arrived_at','route_changed','halt_info')`,
    ),
  ],
);

export const tripReliability = pgTable('trip_reliability', {
  tripId: text('trip_id').primaryKey().references(() => trips.tripId),
  sampleSize: integer('sample_size'),
  onTimeRate: numeric('on_time_rate', { precision: 4, scale: 3 }),
  meanDelayMinutes: numeric('mean_delay_minutes', { precision: 5, scale: 1 }),
  p90DelayMinutes: numeric('p90_delay_minutes', { precision: 5, scale: 1 }),
  cancellationRate: numeric('cancellation_rate', { precision: 4, scale: 3 }),
  lastComputedAt: timestamp('last_computed_at', { withTimezone: true }),
});
