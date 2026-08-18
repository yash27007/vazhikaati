import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  smallint,
  integer,
  boolean,
  numeric,
  date,
  timestamp,
  primaryKey,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const agencies = pgTable(
  'agencies',
  {
    agencyId: text('agency_id').primaryKey(),
    name: text('name').notNull(),
    agencyType: text('agency_type').notNull(),
    stateCode: text('state_code').notNull(),
    parentAgencyId: text('parent_agency_id').references((): AnyPgColumn => agencies.agencyId),
    contactPhone: text('contact_phone'),
    dataTier: smallint('data_tier').notNull().default(2),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      'agencies_agency_type_check',
      sql`${table.agencyType} IN ('state_corp','division','private_stage','informal','aggregator')`,
    ),
  ],
);

export const stops = pgTable(
  'stops',
  {
    stopId: text('stop_id').primaryKey(),
    name: text('name').notNull(),
    nameLocal: text('name_local'),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lon: numeric('lon', { precision: 9, scale: 6 }),
    stopType: text('stop_type'),
    parentStation: text('parent_station').references((): AnyPgColumn => stops.stopId),
    townId: text('town_id'),
    hasShelter: boolean('has_shelter'),
    hasToilet: boolean('has_toilet'),
    hasFood: boolean('has_food'),
    isLitAtNight: boolean('is_lit_at_night'),
    safeOvernight: boolean('safe_overnight').default(false),
    dataTier: smallint('data_tier').default(2),
  },
  (table) => [
    check(
      'stops_stop_type_check',
      sql`${table.stopType} IN ('terminus','town_stand','mofussil_stand','wayside','food_halt','request_stop')`,
    ),
  ],
);

export const routes = pgTable(
  'routes',
  {
    routeId: text('route_id').primaryKey(),
    agencyId: text('agency_id').notNull().references(() => agencies.agencyId),
    routeShortName: text('route_short_name'),
    routeLongName: text('route_long_name'),
    routeType: text('route_type'),
    isOvernight: boolean('is_overnight').default(false),
  },
  (table) => [
    check(
      'routes_route_type_check',
      // 'ac' extends the spec's literal enum to cover the real SETC CSV's
      // plain "A/C" service type, which isn't necessarily a sleeper.
      sql`${table.routeType} IN ('express','ultra_deluxe','deluxe','ordinary','ac_sleeper','ac','town')`,
    ),
  ],
);

export const calendars = pgTable('calendars', {
  serviceId: text('service_id').primaryKey(),
  monday: boolean('monday'),
  tuesday: boolean('tuesday'),
  wednesday: boolean('wednesday'),
  thursday: boolean('thursday'),
  friday: boolean('friday'),
  saturday: boolean('saturday'),
  sunday: boolean('sunday'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
});

export const calendarExceptions = pgTable(
  'calendar_exceptions',
  {
    serviceId: text('service_id').notNull().references(() => calendars.serviceId),
    exceptionDate: date('exception_date').notNull(),
    exceptionType: smallint('exception_type').notNull(),
    reason: text('reason'),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.exceptionDate] }),
    check('calendar_exceptions_type_check', sql`${table.exceptionType} IN (1, 2)`),
  ],
);

export const trips = pgTable('trips', {
  tripId: text('trip_id').primaryKey(),
  routeId: text('route_id').notNull().references(() => routes.routeId),
  serviceId: text('service_id').notNull().references(() => calendars.serviceId),
  headsign: text('headsign'),
  vehicleType: text('vehicle_type'),
  totalSeats: smallint('total_seats'),
  bookable: boolean('bookable').default(true),
  dataTier: smallint('data_tier').default(2),
});

export const stopTimes = pgTable(
  'stop_times',
  {
    tripId: text('trip_id').notNull().references(() => trips.tripId),
    stopSequence: smallint('stop_sequence').notNull(),
    stopId: text('stop_id').notNull().references(() => stops.stopId),
    arrivalMinutes: integer('arrival_minutes'),
    departureMinutes: integer('departure_minutes'),
    haltMinutes: smallint('halt_minutes').default(0),
    isMajorHalt: boolean('is_major_halt').default(false),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.stopSequence] })],
);

export const transfers = pgTable(
  'transfers',
  {
    fromStopId: text('from_stop_id').notNull().references(() => stops.stopId),
    toStopId: text('to_stop_id').notNull().references(() => stops.stopId),
    minTransferMinutes: smallint('min_transfer_minutes').notNull(),
    transferMode: text('transfer_mode'),
    approxCostInr: smallint('approx_cost_inr'),
    notes: text('notes'),
  },
  (table) => [
    primaryKey({ columns: [table.fromStopId, table.toStopId] }),
    check(
      'transfers_mode_check',
      sql`${table.transferMode} IN ('walk','auto','local_bus','same_stand')`,
    ),
  ],
);
