# Ledger, Journey Engine & LLM Tool Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GTFS-shaped ledger, the multi-leg journey engine (search, Connection Confidence, Last Safe Departure), and an OpenAI tool-calling layer on top — all backend, no UI, fully provable via `bun test`.

**Architecture:** Two Postgres databases (local dev, local disposable test) sharing one Drizzle schema, migrated to Neon in production later. Two ingestion scripts populate the ledger (real SETC CSV + a hand-authored synthetic corridor). A pure in-memory graph-search engine reads the ledger per request. Two AI SDK tools wrap the engine for a `ToolLoopAgent`, returning structured data + narration.

**Tech Stack:** Bun (runtime, package manager, test runner), TypeScript, Drizzle ORM (`drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10) against `pg` 8.23.0 (Postgres, local for now), `csv-parse` 7.0.2, AI SDK (`ai` 7.0.66, `@ai-sdk/openai` 4.0.42), Zod 4.

**Spec:** [docs/superpowers/specs/2026-08-18-ledger-engine-tools-design.md](../specs/2026-08-18-ledger-engine-tools-design.md)

## Global Constraints

- Postgres only — no SQLite, no in-memory fallback. Dev/test use the local Postgres 16 server already running on this machine; production will use Neon later (not part of this plan).
- No booking tables (`seat_inventory`, `seat_holds`, `payment_intents`, `bookings`, `reconciliation_log`) and no notification tables this phase — additive later.
- `journey_plans`/`journey_legs` are **not** persisted — search is computed on demand and returned as a plain object.
- Exactly two LLM tools: `plan_journey`, `find_last_safe_departure`. No `get_live_trip_status`, no `check_seat_availability`.
- `arrival_minutes` for real CSV rows is derived from `Route Length ÷ 45 km/h` — one flat, documented constant.
- `reliability_score` is never fabricated: when a trip has no `trip_reliability` row (or `sample_size` is 0), Connection Confidence treats it as "insufficient data," not a guessed number.
- Language handling is system-prompt only — no separate detection/translation step.
- Every tool returns a structured plan object **and** a short narration string, not narration alone.
- No placeholder/guessed OpenAI model IDs — the model id is read from `OPENAI_MODEL` env var with a documented, currently-verified default (`gpt-5.5`, confirmed via the public AI Gateway model catalog on 2026-08-18 — re-verify before going live, since model availability rotates).

---

## Environment already provisioned this session

These exist on the local machine already (re-run only if working from a fresh clone/machine):

```bash
# Role + databases on the local Postgres 16 server (peer auth isn't set up for
# the app user; TCP with password auth is)
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -c \
  "CREATE ROLE vazhikaati LOGIN PASSWORD 'vazhikaati';"
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -c \
  "CREATE DATABASE vazhikaati OWNER vazhikaati;"
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -c \
  "CREATE DATABASE vazhikaati_test OWNER vazhikaati;"
```

Verified working connection strings:
- Dev: `postgresql://vazhikaati:vazhikaati@127.0.0.1:5432/vazhikaati`
- Test: `postgresql://vazhikaati:vazhikaati@127.0.0.1:5432/vazhikaati_test`

Packages already installed this session: `drizzle-orm@0.45.2`, `pg@8.23.0`, `dotenv`, `drizzle-kit@0.31.10` (dev), `@types/pg@8.23.1` (dev), `csv-parse@7.0.2`, `ai@7.0.66`, `@ai-sdk/openai@4.0.42`.

---

### Task 1: Drizzle + Postgres toolchain and test DB harness

**Files:**
- Create: `.env.example`
- Create: `.env.local` (gitignored — real local values)
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/testDb.ts`
- Test: `src/db/client.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `createDb(connectionString: string)` from `src/db/client.ts` — every later task's DB access goes through this.
- Produces: `setupTestDb(): ReturnType<typeof createDb>` from `src/db/testDb.ts` — pushes the current schema onto `DATABASE_URL_TEST` and returns a client. Every test file in later tasks calls this once in a top-level `describe` block.

- [ ] **Step 1: Write `.env.example` and `.env.local`**

`.env.example`:
```
# Local dev database
DATABASE_URL=postgresql://vazhikaati:vazhikaati@127.0.0.1:5432/vazhikaati

# Disposable database used by `bun test` — schema is pushed fresh on every run
DATABASE_URL_TEST=postgresql://vazhikaati:vazhikaati@127.0.0.1:5432/vazhikaati_test

# Production (Neon) connection string — set in Vercel project settings, not here.
# DATABASE_URL=postgresql://<user>:<password>@<neon-host>/<db>?sslmode=require

# Required once the LLM tool layer goes live — leave unset until then.
# OPENAI_API_KEY=
# OPENAI_MODEL=gpt-5.5
```

`.env.local` (same dev/test lines as above, uncommented — this file is gitignored via the existing `.env*` rule).

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 3: Write `src/db/client.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/db/testDb.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { createDb } from './client';

function requireTestUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set — copy .env.example to .env.local first.',
    );
  }
  return url;
}

/** Pushes the current Drizzle schema onto the test database and returns a fresh client. */
export function setupTestDb() {
  const url = requireTestUrl();
  execFileSync('bunx', ['drizzle-kit', 'push', '--force', '--url', url], {
    stdio: 'inherit',
  });
  return createDb(url);
}
```

- [ ] **Step 5: Since there's no schema yet, create an empty schema file so `drizzle-kit` has something to read**

Create `src/db/schema/index.ts`:
```ts
export {};
```

- [ ] **Step 6: Write the failing/first test**

`src/db/client.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { sql } from 'drizzle-orm';
import { setupTestDb } from './testDb';

describe('test database connectivity', () => {
  const db = setupTestDb();

  test('can run a query against the test database', async () => {
    const result = await db.execute(sql`SELECT 1 AS ok`);
    expect(result.rows[0]).toEqual({ ok: 1 });
  });
});
```

- [ ] **Step 7: Run the test**

Run: `bun test src/db/client.test.ts`
Expected: PASS (this task has no prior code to be "red" against — the test's purpose is to prove the toolchain works end-to-end, so it should pass on the first real run once all the files above exist).

- [ ] **Step 8: Add package.json scripts**

Add to `package.json` `"scripts"`:
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"ingest": "bun run src/ingest/runIngest.ts",
"test": "bun test"
```

- [ ] **Step 9: Commit**

```bash
git add .env.example drizzle.config.ts src/db/client.ts src/db/testDb.ts src/db/client.test.ts src/db/schema/index.ts package.json bun.lock
git commit -m "chore: set up Drizzle + Postgres toolchain and test DB harness"
```

(`.env.local` stays untracked — it's covered by the existing `.env*` gitignore rule.)

---

### Task 2: Ledger + reality schema and migrations

**Files:**
- Create: `src/db/schema/ledger.ts`
- Create: `src/db/schema/reality.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/db/testDb.ts` (add `truncateAll`)
- Test: `src/db/schema/schema.test.ts`

**Interfaces:**
- Consumes: `createDb` from Task 1.
- Produces: table objects `agencies, stops, routes, calendars, calendarExceptions, trips, stopTimes, transfers, vehiclePositions, tripObservations, tripReliability` exported from `src/db/schema/index.ts` — every later task imports these by these exact names.
- Produces: `truncateAll(db)` from `src/db/testDb.ts` — used by every subsequent test file to reset state between test files.

- [ ] **Step 1: Write `src/db/schema/ledger.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/db/schema/reality.ts`**

```ts
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
```

- [ ] **Step 3: Re-export both from `src/db/schema/index.ts`**

```ts
export * from './ledger';
export * from './reality';
```

- [ ] **Step 4: Add `truncateAll` to `src/db/testDb.ts`**

Add this function to the existing file:
```ts
export async function truncateAll(db: ReturnType<typeof createDb>) {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    TRUNCATE TABLE
      trip_reliability, trip_observations, vehicle_positions,
      stop_times, transfers, trips, calendar_exceptions, calendars,
      routes, stops, agencies
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 5: Write the failing test**

`src/db/schema/schema.test.ts`:
```ts
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../testDb';
import { agencies, stops, routes, calendars, trips, stopTimes } from './index';

describe('ledger schema', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('accepts a minimal valid row per table and enforces the agency_type check', async () => {
    await db.insert(agencies).values({
      agencyId: 'TEST_AGENCY',
      name: 'Test Agency',
      agencyType: 'division',
      stateCode: 'TN',
    });
    await db.insert(stops).values([
      { stopId: 'A', name: 'Stop A', stopType: 'town_stand' },
      { stopId: 'B', name: 'Stop B', stopType: 'town_stand' },
    ]);
    await db.insert(routes).values({
      routeId: 'R1',
      agencyId: 'TEST_AGENCY',
      routeType: 'ultra_deluxe',
    });
    await db.insert(calendars).values({
      serviceId: 'DAILY',
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
    await db.insert(trips).values({ tripId: 'T1', routeId: 'R1', serviceId: 'DAILY' });
    await db.insert(stopTimes).values([
      { tripId: 'T1', stopSequence: 1, stopId: 'A', arrivalMinutes: 600, departureMinutes: 600 },
      { tripId: 'T1', stopSequence: 2, stopId: 'B', arrivalMinutes: 660, departureMinutes: 660 },
    ]);

    const found = await db.select().from(trips);
    expect(found).toHaveLength(1);

    await expect(
      db.insert(agencies).values({
        agencyId: 'BAD',
        name: 'Bad Agency',
        agencyType: 'not_a_real_type',
        stateCode: 'TN',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run test to see it fail**

Run: `bun test src/db/schema/schema.test.ts`
Expected: FAIL — `Cannot find module './index'` or similar, since the tables don't exist under those export names yet if Step 1-3 weren't done, or a Postgres "relation does not exist" error if the schema file exists but `drizzle-kit push` hasn't run yet against the new tables. (In practice Steps 1-3 are written first in this task, so this red state is brief — the point is to confirm the test actually exercises real inserts, not typos.)

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test src/db/schema/schema.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/ src/db/testDb.ts
git commit -m "feat: add ledger and reality Drizzle schema"
```

---

### Task 3: `parseDepartureTimings` utility

**Files:**
- Create: `src/ingest/parseTiming.ts`
- Test: `src/ingest/parseTiming.test.ts`

**Interfaces:**
- Produces: `parseDepartureTimings(raw: string): number[]` — Task 4 imports this exact name.

- [ ] **Step 1: Write the failing test**

`src/ingest/parseTiming.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/ingest/parseTiming.test.ts`
Expected: FAIL with "Cannot find module './parseTiming'"

- [ ] **Step 3: Implement**

`src/ingest/parseTiming.ts`:
```ts
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
  if (!Number.isInteger(hour) || String(hour) !== hourPart.replace(/^0+(?=\d)/, '') && hourPart !== String(hour) || hour < 0 || hour > 23) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error(`Invalid hour in timing "${entry}"`);
    }
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
```

- [ ] **Step 4: Run test, simplify if needed**

Run: `bun test src/ingest/parseTiming.test.ts`
Expected: PASS. (The hour-validation line above is deliberately over-cautious about leading zeros; if it misbehaves on any real value, simplify it to just `if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw ...` — the leading-zero case never actually occurs in this CSV's hour part, so the simpler check is sufficient and preferred if the test suite doesn't need the stricter one.)

- [ ] **Step 5: Commit**

```bash
git add src/ingest/parseTiming.ts src/ingest/parseTiming.test.ts
git commit -m "feat: parse SETC CSV HH.MM departure timings"
```

---

### Task 4: SETC CSV ingestion

**Files:**
- Create: `src/ingest/setcCsv.ts`
- Create: `src/ingest/fixtures/sample.csv` (small fixture, not the full 549-row file)
- Test: `src/ingest/setcCsv.test.ts`

**Interfaces:**
- Consumes: `parseDepartureTimings` (Task 3), `createDb`/schema tables (Tasks 1-2).
- Produces: `ingestSetcCsv(db, csvPath): Promise<IngestResult>` where `IngestResult = { rowsProcessed: number; rowsRejected: number; rejections: { row: number; reason: string }[] }` — Task 6 imports this exact name and shape.

- [ ] **Step 1: Create the fixture CSV**

`src/ingest/fixtures/sample.csv`:
```
Sl. No.,Depot,Route No.,From,To,Route Length,Type,No.of Service,Departure Timings
1,SHN,192UD,ALANKULAM,CHENNAI,657,ULTRA,1,17.45
2,CB,470AC,CHENNAI,TIRUPPUR,467,A/C,1,21
3,CBE,838UD,BANGALORE,COIMBATORE,377,ULTRA,2,"08.30,20.3"
4,BAD,000XX,,MISSING FROM,100,ULTRA,1,10.00
5,BAD,000YY,MISSING TIMING,SOMEWHERE,120,ULTRA,1,notatime
```

(Row 4 has an empty `From`; row 5 has an unparseable timing — both exist to exercise rejection handling.)

- [ ] **Step 2: Write the failing test**

`src/ingest/setcCsv.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { agencies, stops, routes, trips, stopTimes } from '../db/schema';
import { ingestSetcCsv } from './setcCsv';

describe('ingestSetcCsv', () => {
  const db = setupTestDb();
  const fixturePath = `${import.meta.dir}/fixtures/sample.csv`;

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('imports valid rows and rejects invalid ones', async () => {
    const result = await ingestSetcCsv(db, fixturePath);

    expect(result.rowsProcessed).toBe(3);
    expect(result.rowsRejected).toBe(2);
    expect(result.rejections.map((r) => r.row).sort()).toEqual([4, 5]);
  });

  test('derives arrival time from route length at 45 km/h and tags data_tier 1', async () => {
    await ingestSetcCsv(db, fixturePath);

    const [trip] = await db.select().from(trips).where(eq(trips.tripId, 'SHN-192UD-0'));
    expect(trip.dataTier).toBe(1);

    const legs = await db
      .select()
      .from(stopTimes)
      .where(eq(stopTimes.tripId, 'SHN-192UD-0'));
    const origin = legs.find((l) => l.stopSequence === 1)!;
    const dest = legs.find((l) => l.stopSequence === 2)!;
    expect(origin.departureMinutes).toBe(17 * 60 + 45);
    // 657 km / 45 km/h = 876 minutes, rounded
    expect(dest.arrivalMinutes).toBe(17 * 60 + 45 + Math.round((657 / 45) * 60));
  });

  test('creates one trip per departure time and maps A/C to the ac route type', async () => {
    await ingestSetcCsv(db, fixturePath);

    const acTrips = await db.select().from(trips).where(eq(trips.routeId, 'CB-470AC'));
    expect(acTrips).toHaveLength(1);

    const [route] = await db.select().from(routes).where(eq(routes.routeId, 'CBE-838UD'));
    expect(route.routeType).toBe('ultra_deluxe');

    const multiTrips = await db.select().from(trips).where(eq(trips.routeId, 'CBE-838UD'));
    expect(multiTrips).toHaveLength(2); // "08.30,20.3" -> two departures
  });

  test('is idempotent — running it twice does not duplicate or error', async () => {
    await ingestSetcCsv(db, fixturePath);
    await ingestSetcCsv(db, fixturePath);

    const allTrips = await db.select().from(trips);
    expect(allTrips).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/ingest/setcCsv.test.ts`
Expected: FAIL with "Cannot find module './setcCsv'"

- [ ] **Step 4: Implement**

`src/ingest/setcCsv.ts`:
```ts
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { createDb } from '../db/client';
import { agencies, stops, routes, calendars, trips, stopTimes } from '../db/schema';
import { parseDepartureTimings } from './parseTiming';

const AVERAGE_SPEED_KMH = 45;
const DAILY_CALENDAR_ID = 'SETC_DAILY';

interface CsvRow {
  'Sl. No.': string;
  Depot: string;
  'Route No.': string;
  From: string;
  To: string;
  'Route Length': string;
  Type: string;
  'No.of Service': string;
  'Departure Timings': string;
}

export interface IngestResult {
  rowsProcessed: number;
  rowsRejected: number;
  rejections: { row: number; reason: string }[];
}

function slugifyStopName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function mapRouteType(csvType: string): 'ultra_deluxe' | 'ac' {
  return csvType.trim().toUpperCase() === 'A/C' ? 'ac' : 'ultra_deluxe';
}

export async function ingestSetcCsv(
  db: ReturnType<typeof createDb>,
  csvPath: string,
): Promise<IngestResult> {
  const raw = readFileSync(csvPath, 'utf-8');
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  const result: IngestResult = { rowsProcessed: 0, rowsRejected: 0, rejections: [] };
  const seenAgencies = new Set<string>();
  const seenStops = new Set<string>();

  await db
    .insert(calendars)
    .values({
      serviceId: DAILY_CALENDAR_ID,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
      // No calendar data exists in the source CSV — every imported trip is
      // assumed to run daily. Documented assumption, not a fabricated fact.
      startDate: '2020-01-01',
      endDate: '2035-12-31',
    })
    .onConflictDoNothing();

  for (const row of rows) {
    const rowNum = Number.parseInt(row['Sl. No.'], 10);
    try {
      const depot = row.Depot?.trim();
      const fromName = row.From?.trim();
      const toName = row.To?.trim();
      const lengthKm = Number.parseFloat(row['Route Length']);
      if (!depot || !fromName || !toName || !Number.isFinite(lengthKm) || lengthKm <= 0) {
        throw new Error('missing or invalid depot/from/to/route-length');
      }
      const departures = parseDepartureTimings(row['Departure Timings']);
      if (departures.length === 0) {
        throw new Error('no parseable departure timings');
      }

      if (!seenAgencies.has(depot)) {
        await db
          .insert(agencies)
          .values({
            agencyId: depot,
            name: `SETC ${depot}`,
            agencyType: 'division',
            stateCode: 'TN',
            dataTier: 1,
          })
          .onConflictDoNothing();
        seenAgencies.add(depot);
      }

      for (const townName of [fromName, toName]) {
        const stopId = slugifyStopName(townName);
        if (!seenStops.has(stopId)) {
          await db
            .insert(stops)
            .values({
              stopId,
              name: townName,
              stopType: 'town_stand',
              townId: stopId,
              dataTier: 1,
            })
            .onConflictDoNothing();
          seenStops.add(stopId);
        }
      }

      const fromStopId = slugifyStopName(fromName);
      const toStopId = slugifyStopName(toName);
      const routeId = `${depot}-${row['Route No.'].trim()}`;
      await db
        .insert(routes)
        .values({
          routeId,
          agencyId: depot,
          routeShortName: row['Route No.'].trim(),
          routeLongName: `${fromName} - ${toName}`,
          routeType: mapRouteType(row.Type),
        })
        .onConflictDoNothing();

      const travelMinutes = Math.round((lengthKm / AVERAGE_SPEED_KMH) * 60);

      for (const [index, departureMinutes] of departures.entries()) {
        const tripId = `${routeId}-${index}`;
        await db
          .insert(trips)
          .values({
            tripId,
            routeId,
            serviceId: DAILY_CALENDAR_ID,
            headsign: toName,
            vehicleType: row.Type.trim(),
            bookable: true,
            dataTier: 1,
          })
          .onConflictDoNothing();

        await db
          .insert(stopTimes)
          .values([
            {
              tripId,
              stopSequence: 1,
              stopId: fromStopId,
              arrivalMinutes: departureMinutes,
              departureMinutes,
              haltMinutes: 0,
            },
            {
              tripId,
              stopSequence: 2,
              stopId: toStopId,
              arrivalMinutes: departureMinutes + travelMinutes,
              departureMinutes: departureMinutes + travelMinutes,
              haltMinutes: 0,
            },
          ])
          .onConflictDoNothing();
      }

      result.rowsProcessed++;
    } catch (error) {
      result.rowsRejected++;
      result.rejections.push({ row: rowNum, reason: (error as Error).message });
    }
  }

  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/ingest/setcCsv.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ingest/setcCsv.ts src/ingest/setcCsv.test.ts src/ingest/fixtures/sample.csv
git commit -m "feat: ingest the real SETC CSV into tier-1 trips"
```

---

### Task 5: Synthetic demo corridor ingestion

**Files:**
- Create: `src/ingest/demoCorridor.ts`
- Test: `src/ingest/demoCorridor.test.ts`

**Interfaces:**
- Produces: `ingestDemoCorridor(db): Promise<void>`.
- Produces exact stop/trip IDs later tasks depend on: stops `OOTY_STAND`, `METTUPALAYAM_STAND`, `TIRUPUR_OLD_STAND`, `TIRUPUR_NEW_STAND`, `MADURAI_STAND`, `SRIVILLIPUTHUR_STAND`; trips `OOTY_MTP_EARLY`, `OOTY_MTP_A`, `OOTY_MTP_B`, `MTP_TPR_EARLY`, `MTP_TPR_A`, `MTP_TPR_B`, `TPR_MDU_LAST`, `TPR_MDU_EARLY`, `MDU_SVP_LAST`, `MDU_SVP_EARLY`. Tasks 7-10's tests assert against these exact names and the minute values below.

This corridor's numbers are hand-derived to reproduce the product spec's own worked example exactly: **the 15:40 Ooty departure is the last safe one; the next (17:20) reaches Tirupur at 21:40, 25 minutes after the last Tirupur→Madurai departure (21:15); the next connection isn't until 04:30 the next day.**

- [ ] **Step 1: Write the failing test**

`src/ingest/demoCorridor.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { stops, trips, stopTimes, transfers } from '../db/schema';
import { ingestDemoCorridor } from './demoCorridor';

describe('ingestDemoCorridor', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  test('creates all six stops, flagged tier 3, with the Tirupur stands unsafe overnight', async () => {
    await ingestDemoCorridor(db);

    const allStops = await db.select().from(stops);
    expect(allStops.map((s) => s.stopId).sort()).toEqual(
      [
        'MADURAI_STAND',
        'METTUPALAYAM_STAND',
        'OOTY_STAND',
        'SRIVILLIPUTHUR_STAND',
        'TIRUPUR_NEW_STAND',
        'TIRUPUR_OLD_STAND',
      ].sort(),
    );
    expect(allStops.every((s) => s.dataTier === 3)).toBe(true);

    const [tirupurOld] = await db.select().from(stops).where(eq(stops.stopId, 'TIRUPUR_OLD_STAND'));
    expect(tirupurOld.safeOvernight).toBe(false);
  });

  test('creates the Tirupur cross-stand transfer', async () => {
    await ingestDemoCorridor(db);
    const [transfer] = await db
      .select()
      .from(transfers)
      .where(eq(transfers.fromStopId, 'TIRUPUR_OLD_STAND'));
    expect(transfer.toStopId).toBe('TIRUPUR_NEW_STAND');
    expect(transfer.minTransferMinutes).toBe(10);
  });

  test('reproduces the exact worked-example timings', async () => {
    await ingestDemoCorridor(db);

    const legTimes = async (tripId: string) => {
      const legs = await db.select().from(stopTimes).where(eq(stopTimes.tripId, tripId));
      const origin = legs.find((l) => l.stopSequence === 1)!;
      const dest = legs.find((l) => l.stopSequence === 2)!;
      return { dep: origin.departureMinutes, arr: dest.arrivalMinutes };
    };

    expect(await legTimes('OOTY_MTP_A')).toEqual({ dep: 15 * 60 + 40, arr: 17 * 60 + 10 });
    expect(await legTimes('OOTY_MTP_B')).toEqual({ dep: 17 * 60 + 20, arr: 18 * 60 + 50 });
    expect(await legTimes('MTP_TPR_B')).toEqual({ dep: 19 * 60 + 45, arr: 21 * 60 + 40 });
    expect(await legTimes('TPR_MDU_LAST')).toEqual({ dep: 21 * 60 + 15, arr: 22 * 60 });
    expect(await legTimes('TPR_MDU_EARLY')).toEqual({ dep: 4 * 60 + 30, arr: 5 * 60 + 15 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/ingest/demoCorridor.test.ts`
Expected: FAIL with "Cannot find module './demoCorridor'"

- [ ] **Step 3: Implement**

`src/ingest/demoCorridor.ts`:
```ts
import type { createDb } from '../db/client';
import { agencies, stops, routes, calendars, trips, stopTimes, transfers } from '../db/schema';

const DEMO_AGENCY_ID = 'DEMO';
const DEMO_CALENDAR_ID = 'DEMO_DAILY';

interface DemoTrip {
  tripId: string;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  departureMinutes: number;
  arrivalMinutes: number;
}

const DEMO_TRIPS: DemoTrip[] = [
  { tripId: 'OOTY_MTP_EARLY', routeId: 'DEMO-OOTY-MTP', fromStopId: 'OOTY_STAND', toStopId: 'METTUPALAYAM_STAND', departureMinutes: 480, arrivalMinutes: 570 },
  { tripId: 'OOTY_MTP_A', routeId: 'DEMO-OOTY-MTP', fromStopId: 'OOTY_STAND', toStopId: 'METTUPALAYAM_STAND', departureMinutes: 940, arrivalMinutes: 1030 },
  { tripId: 'OOTY_MTP_B', routeId: 'DEMO-OOTY-MTP', fromStopId: 'OOTY_STAND', toStopId: 'METTUPALAYAM_STAND', departureMinutes: 1040, arrivalMinutes: 1130 },

  // Departures sit 55 minutes after the inbound Ooty->Mettupalayam arrival
  // (50 minutes of slack over the 5-minute default same-stand buffer) so
  // this transfer scores "safe" — the only connection this corridor is
  // meant to threaten is the one at Tirupur.
  { tripId: 'MTP_TPR_EARLY', routeId: 'DEMO-MTP-TPR', fromStopId: 'METTUPALAYAM_STAND', toStopId: 'TIRUPUR_OLD_STAND', departureMinutes: 625, arrivalMinutes: 740 },
  { tripId: 'MTP_TPR_A', routeId: 'DEMO-MTP-TPR', fromStopId: 'METTUPALAYAM_STAND', toStopId: 'TIRUPUR_OLD_STAND', departureMinutes: 1085, arrivalMinutes: 1200 },
  { tripId: 'MTP_TPR_B', routeId: 'DEMO-MTP-TPR', fromStopId: 'METTUPALAYAM_STAND', toStopId: 'TIRUPUR_OLD_STAND', departureMinutes: 1185, arrivalMinutes: 1300 },

  // The last Tirupur -> Madurai service of the day. Miss this and the next
  // one isn't until 04:30 the following morning.
  { tripId: 'TPR_MDU_LAST', routeId: 'DEMO-TPR-MDU', fromStopId: 'TIRUPUR_NEW_STAND', toStopId: 'MADURAI_STAND', departureMinutes: 1275, arrivalMinutes: 1320 },
  { tripId: 'TPR_MDU_EARLY', routeId: 'DEMO-TPR-MDU', fromStopId: 'TIRUPUR_NEW_STAND', toStopId: 'MADURAI_STAND', departureMinutes: 270, arrivalMinutes: 315 },

  { tripId: 'MDU_SVP_LAST', routeId: 'DEMO-MDU-SVP', fromStopId: 'MADURAI_STAND', toStopId: 'SRIVILLIPUTHUR_STAND', departureMinutes: 1350, arrivalMinutes: 1410 },
  { tripId: 'MDU_SVP_EARLY', routeId: 'DEMO-MDU-SVP', fromStopId: 'MADURAI_STAND', toStopId: 'SRIVILLIPUTHUR_STAND', departureMinutes: 345, arrivalMinutes: 405 },
];

/**
 * Hand-authored, clearly-flagged synthetic (tier-3) corridor reproducing the
 * worked example from the product spec: Ooty -> Mettupalayam -> Tirupur ->
 * Madurai -> Srivilliputhur, including the deliberate stranding scenario.
 * Nothing here is real published SETC data.
 */
export async function ingestDemoCorridor(db: ReturnType<typeof createDb>): Promise<void> {
  await db
    .insert(agencies)
    .values({
      agencyId: DEMO_AGENCY_ID,
      name: 'Demo Corridor (synthetic — not a real operator)',
      agencyType: 'informal',
      stateCode: 'TN',
      dataTier: 3,
    })
    .onConflictDoNothing();

  await db
    .insert(calendars)
    .values({
      serviceId: DEMO_CALENDAR_ID,
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true,
      startDate: '2020-01-01',
      endDate: '2035-12-31',
    })
    .onConflictDoNothing();

  await db
    .insert(stops)
    .values([
      { stopId: 'OOTY_STAND', name: 'Ooty Bus Stand', stopType: 'terminus', townId: 'OOTY', dataTier: 3 },
      { stopId: 'METTUPALAYAM_STAND', name: 'Mettupalayam Bus Stand', stopType: 'town_stand', townId: 'METTUPALAYAM', dataTier: 3 },
      { stopId: 'TIRUPUR_OLD_STAND', name: 'Tirupur Old Bus Stand', stopType: 'mofussil_stand', townId: 'TIRUPUR', safeOvernight: false, isLitAtNight: true, dataTier: 3 },
      { stopId: 'TIRUPUR_NEW_STAND', name: 'Tirupur New Bus Stand', stopType: 'mofussil_stand', townId: 'TIRUPUR', safeOvernight: false, isLitAtNight: true, dataTier: 3 },
      { stopId: 'MADURAI_STAND', name: 'Madurai Bus Stand', stopType: 'terminus', townId: 'MADURAI', dataTier: 3 },
      { stopId: 'SRIVILLIPUTHUR_STAND', name: 'Srivilliputhur Bus Stand', stopType: 'town_stand', townId: 'SRIVILLIPUTHUR', dataTier: 3 },
    ])
    .onConflictDoNothing();

  await db
    .insert(transfers)
    .values({
      fromStopId: 'TIRUPUR_OLD_STAND',
      toStopId: 'TIRUPUR_NEW_STAND',
      minTransferMinutes: 10,
      transferMode: 'auto',
      approxCostInr: 30,
      notes: 'Cross-town auto between the two Tirupur stands',
    })
    .onConflictDoNothing();

  await db
    .insert(routes)
    .values([
      { routeId: 'DEMO-OOTY-MTP', agencyId: DEMO_AGENCY_ID, routeShortName: 'D1', routeLongName: 'Ooty - Mettupalayam', routeType: 'ultra_deluxe' },
      { routeId: 'DEMO-MTP-TPR', agencyId: DEMO_AGENCY_ID, routeShortName: 'D2', routeLongName: 'Mettupalayam - Tirupur', routeType: 'ultra_deluxe' },
      { routeId: 'DEMO-TPR-MDU', agencyId: DEMO_AGENCY_ID, routeShortName: 'D3', routeLongName: 'Tirupur - Madurai', routeType: 'ultra_deluxe' },
      { routeId: 'DEMO-MDU-SVP', agencyId: DEMO_AGENCY_ID, routeShortName: 'D4', routeLongName: 'Madurai - Srivilliputhur', routeType: 'ultra_deluxe' },
    ])
    .onConflictDoNothing();

  for (const t of DEMO_TRIPS) {
    await db
      .insert(trips)
      .values({
        tripId: t.tripId,
        routeId: t.routeId,
        serviceId: DEMO_CALENDAR_ID,
        headsign: t.toStopId,
        vehicleType: 'ULTRA',
        bookable: true,
        dataTier: 3,
      })
      .onConflictDoNothing();

    await db
      .insert(stopTimes)
      .values([
        { tripId: t.tripId, stopSequence: 1, stopId: t.fromStopId, arrivalMinutes: t.departureMinutes, departureMinutes: t.departureMinutes, haltMinutes: 0 },
        { tripId: t.tripId, stopSequence: 2, stopId: t.toStopId, arrivalMinutes: t.arrivalMinutes, departureMinutes: t.arrivalMinutes, haltMinutes: 0 },
      ])
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/ingest/demoCorridor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ingest/demoCorridor.ts src/ingest/demoCorridor.test.ts
git commit -m "feat: hand-author the synthetic Ooty-Srivilliputhur demo corridor"
```

---

### Task 6: Ingestion CLI entrypoint

**Files:**
- Create: `src/ingest/runIngest.ts`

**Interfaces:**
- Consumes: `db` (Task 1), `ingestSetcCsv` (Task 4), `ingestDemoCorridor` (Task 5).

This is an operational script, not a unit — its "test" is running it for real against the dev database and confirming it reports sane counts and exits cleanly. Idempotency of the underlying ingestion functions is already covered by Task 4's test.

- [ ] **Step 1: Implement**

`src/ingest/runIngest.ts`:
```ts
import { db } from '../db/client';
import { ingestSetcCsv } from './setcCsv';
import { ingestDemoCorridor } from './demoCorridor';

async function main() {
  const csvPath = process.argv[2] ?? 'SETCbustimings_1_0.csv';
  console.log(`Ingesting SETC CSV from ${csvPath}...`);
  const result = await ingestSetcCsv(db, csvPath);
  console.log(`  ${result.rowsProcessed} rows imported, ${result.rowsRejected} rejected.`);
  for (const r of result.rejections) {
    console.log(`    row ${r.row}: ${r.reason}`);
  }

  console.log('Ingesting synthetic demo corridor...');
  await ingestDemoCorridor(db);
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Push the schema onto the dev database and run it for real**

Run:
```bash
bunx drizzle-kit push --force
bun run ingest
```
Expected: prints `549` (or close to it) rows imported, a small number rejected (only rows with missing fields), then "Ingesting synthetic demo corridor..." then "Done." with no thrown error. (`SETCbustimings_1_0.csv` must be present in the project root — see the README's "Data source" section.)

- [ ] **Step 3: Run it a second time to confirm idempotency against the real file too**

Run: `bun run ingest`
Expected: same output, no errors, no duplicate-key failures.

- [ ] **Step 4: Commit**

```bash
git add src/ingest/runIngest.ts
git commit -m "feat: add ingestion CLI entrypoint"
```

---

### Task 7: Connection loading and the earliest-arrival scan algorithm

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/engine/loadConnections.ts`
- Create: `src/engine/connectionScan.ts`
- Test: `src/engine/connectionScan.test.ts` (pure algorithm, synthetic fixtures — no DB)
- Test: `src/engine/loadConnections.test.ts` (against the seeded demo corridor)

**Interfaces:**
- Produces: `Connection`, `TransferEdge`, `ConfidenceBand`, `JourneyLeg`, `JourneyPlanResult` types from `src/engine/types.ts` — every remaining task imports these.
- Produces: `loadConnections(db, dates: string[]): Promise<{ connections: Connection[]; transferEdges: TransferEdge[] }>`.
- Produces: `earliestArrival(connections, transferEdges, originStopId, destinationStopId, startAbsMin, maxLegs, defaultSameStopBufferMin): { found: boolean; legs: Connection[] }` — pure function, no DB access. Tasks 9-10 call this directly.

- [ ] **Step 1: Write `src/engine/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test for the pure algorithm**

`src/engine/connectionScan.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { earliestArrival } from './connectionScan';
import type { Connection, TransferEdge } from './types';

function conn(partial: Partial<Connection> & Pick<Connection, 'tripId' | 'fromStopId' | 'toStopId' | 'departureAbsMin' | 'arrivalAbsMin'>): Connection {
  return { routeId: partial.tripId, dataTier: 1, ...partial };
}

describe('earliestArrival', () => {
  test('finds a direct connection', () => {
    const connections = [conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 })];
    const result = earliestArrival(connections, [], 'A', 'B', 90, 4, 5);
    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1']);
  });

  test('chains two legs respecting a minimum same-stop transfer buffer', () => {
    const connections = [
      conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 }),
      conn({ tripId: 'T2', fromStopId: 'B', toStopId: 'C', departureAbsMin: 153, arrivalAbsMin: 200 }), // only 3 min buffer
      conn({ tripId: 'T3', fromStopId: 'B', toStopId: 'C', departureAbsMin: 160, arrivalAbsMin: 210 }), // 10 min buffer
    ];
    const result = earliestArrival(connections, [], 'A', 'C', 90, 4, 5);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1', 'T3']); // T2 excluded — under the 5 min buffer
  });

  test('uses a transfer edge to reach a departure from a different stop in the same town', () => {
    const connections = [
      conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B_OLD', departureAbsMin: 100, arrivalAbsMin: 150 }),
      conn({ tripId: 'T2', fromStopId: 'B_NEW', toStopId: 'C', departureAbsMin: 165, arrivalAbsMin: 200 }),
    ];
    const transferEdges: TransferEdge[] = [{ fromStopId: 'B_OLD', toStopId: 'B_NEW', minTransferMinutes: 10 }];
    const result = earliestArrival(connections, transferEdges, 'A', 'C', 90, 4, 5);
    expect(result.legs.map((l) => l.tripId)).toEqual(['T1', 'T2']);
  });

  test('respects maxLegs', () => {
    const connections = [
      conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 }),
      conn({ tripId: 'T2', fromStopId: 'B', toStopId: 'C', departureAbsMin: 160, arrivalAbsMin: 210 }),
      conn({ tripId: 'T3', fromStopId: 'C', toStopId: 'D', departureAbsMin: 220, arrivalAbsMin: 260 }),
    ];
    expect(earliestArrival(connections, [], 'A', 'D', 90, 2, 5).found).toBe(false);
    expect(earliestArrival(connections, [], 'A', 'D', 90, 3, 5).found).toBe(true);
  });

  test('reports not found when no chain exists', () => {
    const connections = [conn({ tripId: 'T1', fromStopId: 'A', toStopId: 'B', departureAbsMin: 100, arrivalAbsMin: 150 })];
    const result = earliestArrival(connections, [], 'A', 'Z', 90, 4, 5);
    expect(result.found).toBe(false);
    expect(result.legs).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/engine/connectionScan.test.ts`
Expected: FAIL with "Cannot find module './connectionScan'"

- [ ] **Step 4: Implement `src/engine/connectionScan.ts`**

```ts
import type { Connection, TransferEdge } from './types';

export interface ScanResult {
  found: boolean;
  legs: Connection[];
}

interface Frontier {
  stopId: string;
  time: number;
  legs: number;
  path: Connection[];
}

/**
 * Earliest-arrival search bounded by maxLegs, over a small in-memory
 * connection list (a few hundred edges at most — this project's whole
 * point is that the network is small once it's actually written down).
 *
 * States are keyed by (stop, legsUsed) rather than just stop, so a
 * fewer-legs-but-later-arrival state is never discarded in favor of a
 * more-legs-but-earlier one — either might be the one that can still
 * reach the destination within maxLegs.
 */
export function earliestArrival(
  connections: Connection[],
  transferEdges: TransferEdge[],
  originStopId: string,
  destinationStopId: string,
  startAbsMin: number,
  maxLegs: number,
  defaultSameStopBufferMin: number,
): ScanResult {
  const byFromStop = new Map<string, Connection[]>();
  for (const c of connections) {
    const list = byFromStop.get(c.fromStopId) ?? [];
    list.push(c);
    byFromStop.set(c.fromStopId, list);
  }
  for (const list of byFromStop.values()) {
    list.sort((a, b) => a.departureAbsMin - b.departureAbsMin);
  }

  const transfersFrom = new Map<string, TransferEdge[]>();
  for (const t of transferEdges) {
    const list = transfersFrom.get(t.fromStopId) ?? [];
    list.push(t);
    transfersFrom.set(t.fromStopId, list);
  }

  function reachableDepartures(stopId: string, time: number, legs: number): Connection[] {
    const options: Connection[] = [];
    const sameStopBuffer = legs === 0 ? 0 : defaultSameStopBufferMin;
    for (const c of byFromStop.get(stopId) ?? []) {
      if (c.departureAbsMin >= time + sameStopBuffer) options.push(c);
    }
    if (legs > 0) {
      for (const t of transfersFrom.get(stopId) ?? []) {
        for (const c of byFromStop.get(t.toStopId) ?? []) {
          if (c.departureAbsMin >= time + t.minTransferMinutes) options.push(c);
        }
      }
    }
    return options;
  }

  const bestAtState = new Map<string, number>();
  const frontier: Frontier[] = [{ stopId: originStopId, time: startAbsMin, legs: 0, path: [] }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.time - b.time);
    const current = frontier.shift()!;

    if (current.stopId === destinationStopId && current.path.length > 0) {
      return { found: true, legs: current.path };
    }
    if (current.legs >= maxLegs) continue;

    const key = `${current.stopId}:${current.legs}`;
    const known = bestAtState.get(key);
    if (known !== undefined && known < current.time) continue;
    bestAtState.set(key, current.time);

    for (const connection of reachableDepartures(current.stopId, current.time, current.legs)) {
      const nextLegs = current.legs + 1;
      const nextKey = `${connection.toStopId}:${nextLegs}`;
      const bestKnown = bestAtState.get(nextKey);
      if (bestKnown !== undefined && bestKnown <= connection.arrivalAbsMin) continue;
      frontier.push({
        stopId: connection.toStopId,
        time: connection.arrivalAbsMin,
        legs: nextLegs,
        path: [...current.path, connection],
      });
    }
  }

  return { found: false, legs: [] };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/engine/connectionScan.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for `loadConnections`**

`src/engine/loadConnections.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { loadConnections } from './loadConnections';

describe('loadConnections', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('expands trips into date-anchored connections and includes the transfer edge', async () => {
    const { connections, transferEdges } = await loadConnections(db, ['2026-08-16']);

    const ootyLegs = connections.filter((c) => c.fromStopId === 'OOTY_STAND');
    expect(ootyLegs).toHaveLength(3); // EARLY, A, B

    expect(transferEdges).toEqual([
      { fromStopId: 'TIRUPUR_OLD_STAND', toStopId: 'TIRUPUR_NEW_STAND', minTransferMinutes: 10 },
    ]);
  });

  test('produces comparable absolute times across two different dates', async () => {
    const { connections } = await loadConnections(db, ['2026-08-16', '2026-08-17']);
    const day1 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && new Date(c.departureAbsMin * 60000).toISOString().startsWith('2026-08-16'));
    const day2 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && new Date(c.departureAbsMin * 60000).toISOString().startsWith('2026-08-17'));
    expect(day1).toBeDefined();
    expect(day2).toBeDefined();
    expect(day2!.departureAbsMin - day1!.departureAbsMin).toBe(24 * 60);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test src/engine/loadConnections.test.ts`
Expected: FAIL with "Cannot find module './loadConnections'"

- [ ] **Step 8: Implement `src/engine/loadConnections.ts`**

```ts
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
  return Date.parse(`${dateStr}T00:00:00Z`) / 60000 + minutesPastMidnight;
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
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test src/engine/loadConnections.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/engine/types.ts src/engine/loadConnections.ts src/engine/connectionScan.ts src/engine/loadConnections.test.ts src/engine/connectionScan.test.ts
git commit -m "feat: load ledger data into an in-memory graph and add the earliest-arrival scan"
```

---

### Task 8: Connection Confidence scoring

**Files:**
- Create: `src/engine/confidence.ts`
- Test: `src/engine/confidence.test.ts`

**Interfaces:**
- Produces: `scoreConfidence(input: ConfidenceInput): { band: ConfidenceBand; reasons: string[] }` (pure function) and `getReliability(db, tripId): Promise<{ sampleSize: number; onTimeRate: number } | null>` — Task 9 imports both exact names.

- [ ] **Step 1: Write the failing test**

`src/engine/confidence.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, truncateAll } from '../db/testDb';
import { agencies, stops, routes, calendars, trips, tripReliability } from '../db/schema';
import { scoreConfidence, getReliability } from './confidence';

describe('scoreConfidence', () => {
  test('first leg of a journey is always safe (no incoming transfer to assess)', () => {
    const { band } = scoreConfidence({
      transferBufferMinutes: null,
      isLastServiceOfDayForNextLeg: false,
      reliability: null,
      dataTier: 1,
      isDestinationReachableIfMissed: true,
    });
    expect(band).toBe('safe');
  });

  test('bands by buffer per the spec thresholds', () => {
    expect(scoreConfidence({ transferBufferMinutes: 60, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('safe');
    expect(scoreConfidence({ transferBufferMinutes: 30, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('tight');
    expect(scoreConfidence({ transferBufferMinutes: 10, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('risky');
    expect(scoreConfidence({ transferBufferMinutes: -5, isLastServiceOfDayForNextLeg: false, reliability: null, dataTier: 1, isDestinationReachableIfMissed: true }).band).toBe('broken');
  });

  test('last service of the day forces risky even with a nominally comfortable buffer', () => {
    const { band, reasons } = scoreConfidence({
      transferBufferMinutes: 60,
      isLastServiceOfDayForNextLeg: true,
      reliability: null,
      dataTier: 1,
      isDestinationReachableIfMissed: false,
    });
    expect(band).toBe('risky');
    expect(reasons.some((r) => r.includes('last service'))).toBe(true);
  });

  test('never fabricates a reliability number — missing data is reported, not defaulted', () => {
    const { reasons } = scoreConfidence({
      transferBufferMinutes: 60,
      isLastServiceOfDayForNextLeg: false,
      reliability: null,
      dataTier: 1,
      isDestinationReachableIfMissed: true,
    });
    expect(reasons.some((r) => r.includes('no reliability history'))).toBe(true);
  });

  test('an unreliable inbound leg downgrades an otherwise-safe buffer to tight', () => {
    const { band } = scoreConfidence({
      transferBufferMinutes: 50,
      isLastServiceOfDayForNextLeg: false,
      reliability: { sampleSize: 20, onTimeRate: 0.5 },
      dataTier: 1,
      isDestinationReachableIfMissed: true,
    });
    expect(band).toBe('tight');
  });
});

describe('getReliability', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await db.insert(agencies).values({ agencyId: 'A', name: 'A', agencyType: 'division', stateCode: 'TN' });
    await db.insert(routes).values({ routeId: 'R', agencyId: 'A', routeType: 'ultra_deluxe' });
    await db.insert(calendars).values({
      serviceId: 'S', monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true, startDate: '2026-01-01', endDate: '2027-01-01',
    });
    await db.insert(trips).values([
      { tripId: 'HAS_DATA', routeId: 'R', serviceId: 'S' },
      { tripId: 'NO_DATA', routeId: 'R', serviceId: 'S' },
    ]);
    await db.insert(tripReliability).values({ tripId: 'HAS_DATA', sampleSize: 12, onTimeRate: '0.750' });
  });

  test('returns the observed rate when a reliability row with samples exists', async () => {
    const result = await getReliability(db, 'HAS_DATA');
    expect(result).toEqual({ sampleSize: 12, onTimeRate: 0.75 });
  });

  test('returns null when no row exists', async () => {
    expect(await getReliability(db, 'NO_DATA')).toBeNull();
  });

  test('returns null when a row exists but sample_size is 0', async () => {
    await db.insert(trips).values({ tripId: 'ZERO', routeId: 'R', serviceId: 'S' });
    await db.insert(tripReliability).values({ tripId: 'ZERO', sampleSize: 0, onTimeRate: '0.000' });
    expect(await getReliability(db, 'ZERO')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/engine/confidence.test.ts`
Expected: FAIL with "Cannot find module './confidence'"

- [ ] **Step 3: Implement**

`src/engine/confidence.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { tripReliability } from '../db/schema';
import type { ConfidenceBand } from './types';

export interface ConfidenceInput {
  /** Scheduled gap minus the minimum required transfer time. null for a journey's first leg. */
  transferBufferMinutes: number | null;
  isLastServiceOfDayForNextLeg: boolean;
  reliability: { sampleSize: number; onTimeRate: number } | null;
  dataTier: number;
  isDestinationReachableIfMissed: boolean;
}

export interface ConfidenceResult {
  band: ConfidenceBand;
  reasons: string[];
}

const UNRELIABLE_ON_TIME_RATE_THRESHOLD = 0.7;

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];

  if (!input.isDestinationReachableIfMissed) {
    reasons.push('this is the last service of the day for this connection — missing it means no fallback today');
  }

  if (input.reliability === null) {
    reasons.push('no reliability history yet for this leg — confidence is based on schedule structure only');
  }

  const unreliableInbound =
    input.reliability !== null && input.reliability.onTimeRate < UNRELIABLE_ON_TIME_RATE_THRESHOLD;
  if (unreliableInbound) {
    const latePercent = Math.round((1 - input.reliability!.onTimeRate) * 100);
    reasons.push(`this leg has run late in about ${latePercent}% of observed trips`);
  }

  if (input.transferBufferMinutes === null) {
    return { band: 'safe', reasons };
  }

  if (input.transferBufferMinutes < 0) {
    return { band: 'broken', reasons: [...reasons, 'the connecting service does not run after this leg arrives'] };
  }

  if (input.transferBufferMinutes < 20 || input.isLastServiceOfDayForNextLeg) {
    reasons.push(`only ${input.transferBufferMinutes} minutes of slack to make this connection`);
    return { band: 'risky', reasons };
  }

  if (input.transferBufferMinutes < 45 || unreliableInbound) {
    reasons.push(`${input.transferBufferMinutes} minutes of slack to make this connection`);
    return { band: 'tight', reasons };
  }

  return { band: 'safe', reasons };
}

export async function getReliability(
  db: ReturnType<typeof createDb>,
  tripId: string,
): Promise<{ sampleSize: number; onTimeRate: number } | null> {
  const [row] = await db.select().from(tripReliability).where(eq(tripReliability.tripId, tripId));
  if (!row || !row.sampleSize || row.sampleSize <= 0 || row.onTimeRate === null) return null;
  return { sampleSize: row.sampleSize, onTimeRate: Number(row.onTimeRate) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/engine/confidence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/confidence.ts src/engine/confidence.test.ts
git commit -m "feat: score Connection Confidence with honest cold-start handling"
```

---

### Task 9: Forward search (`plan_journey`)

**Files:**
- Create: `src/engine/shared.ts`
- Create: `src/engine/search.ts`
- Test: `src/engine/search.test.ts`

**Interfaces:**
- Consumes: `loadConnections`, `earliestArrival` (Task 7), `scoreConfidence`, `getReliability` (Task 8).
- Produces: `resolveStopId(db, query): Promise<string>`, `StopNotFoundError`, `dateRangeFrom(isoDateTime, days): string[]`, `worstBand(bands): ConfidenceBand` from `shared.ts`.
- Produces: `planJourney(db, input): Promise<JourneyPlanResult>` and `buildLegsWithConfidence(scanLegs, allConnections, transferEdges, db): Promise<JourneyLeg[]>` from `search.ts` — Task 10 imports both exact names.

- [ ] **Step 1: Write `src/engine/shared.ts`**

```ts
import { eq, ilike } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { stops } from '../db/schema';
import type { ConfidenceBand } from './types';

export class StopNotFoundError extends Error {
  constructor(public readonly query: string) {
    super(`No stop found matching "${query}"`);
  }
}

function slugify(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function resolveStopId(db: ReturnType<typeof createDb>, query: string): Promise<string> {
  const normalized = query.trim();

  const bySlug = await db.select().from(stops).where(eq(stops.stopId, slugify(normalized))).limit(1);
  if (bySlug.length > 0) return bySlug[0].stopId;

  const byName = await db.select().from(stops).where(ilike(stops.name, normalized)).limit(1);
  if (byName.length > 0) return byName[0].stopId;

  throw new StopNotFoundError(query);
}

/**
 * Returns an inclusive array of YYYY-MM-DD date strings.
 * days > 0: from the reference date's day forward through +days.
 * days < 0: from -|days| before the reference date's day through the reference day itself.
 */
export function dateRangeFrom(isoDateTime: string, days: number): string[] {
  const start = new Date(isoDateTime);
  const startDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const lowerBound = days < 0 ? -Math.abs(days) : 0;
  const upperBound = days < 0 ? 0 : days;
  const dates: string[] = [];
  for (let offset = lowerBound; offset <= upperBound; offset++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + offset);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const BAND_ORDER: ConfidenceBand[] = ['safe', 'tight', 'risky', 'broken'];

export function worstBand(bands: ConfidenceBand[]): ConfidenceBand {
  return bands.reduce(
    (worst, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(worst) ? b : worst),
    'safe' as ConfidenceBand,
  );
}
```

- [ ] **Step 2: Write the failing test**

`src/engine/search.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { planJourney } from './search';

describe('planJourney', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('finds the full 4-leg Ooty -> Srivilliputhur chain departing at 15:40', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00Z',
    });

    expect(result.found).toBe(true);
    expect(result.legs.map((l) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
  });

  test('scores the Tirupur transfer safe and the Madurai transfer tight', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00Z',
    });

    const tirupurLeg = result.legs.find((l) => l.tripId === 'TPR_MDU_LAST')!;
    const maduraiLeg = result.legs.find((l) => l.tripId === 'MDU_SVP_LAST')!;
    expect(tirupurLeg.confidence).toBe('safe');
    expect(maduraiLeg.confidence).toBe('tight');
    expect(result.overallConfidence).toBe('tight');
  });

  test('reports not found for an unreachable destination within maxLegs', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00Z',
      maxLegs: 2,
    });
    expect(result.found).toBe(false);
    expect(result.overallConfidence).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/engine/search.test.ts`
Expected: FAIL with "Cannot find module './search'"

- [ ] **Step 4: Implement `src/engine/search.ts`**

```ts
import type { createDb } from '../db/client';
import { loadConnections } from './loadConnections';
import { earliestArrival } from './connectionScan';
import { scoreConfidence, getReliability } from './confidence';
import { resolveStopId, dateRangeFrom, worstBand } from './shared';
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
  const startAbsMin = Date.parse(input.departAfter) / 60000;
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
      departureAbsMin: leg.departureAbsMin,
      arrivalAbsMin: leg.arrivalAbsMin,
      dataTier: leg.dataTier,
      confidence: band,
      confidenceReasons: reasons,
    });
  }

  return legs;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/engine/search.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/shared.ts src/engine/search.ts src/engine/search.test.ts
git commit -m "feat: forward multi-leg journey search with confidence scoring"
```

---

### Task 10: Last Safe Departure

**Files:**
- Create: `src/engine/lastSafeDeparture.ts`
- Test: `src/engine/lastSafeDeparture.test.ts`

**Interfaces:**
- Consumes: `loadConnections`, `earliestArrival` (Task 7), `buildLegsWithConfidence` (Task 9), `resolveStopId`, `dateRangeFrom`, `worstBand` (Task 9).
- Produces: `findLastSafeDeparture(db, input): Promise<LastSafeDepartureResult>` — Task 11 imports this exact name.

- [ ] **Step 1: Write the failing test**

`src/engine/lastSafeDeparture.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { findLastSafeDeparture } from './lastSafeDeparture';

describe('findLastSafeDeparture', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('picks the 15:40 Ooty departure, not the earlier 08:00 one, as the last safe option', async () => {
    const result = await findLastSafeDeparture(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      arriveBy: '2026-08-17T08:00:00Z',
    });

    expect(result.found).toBe(true);
    expect(result.legs[0].tripId).toBe('OOTY_MTP_A'); // the 15:40 departure
    expect(result.legs.map((l) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
  });

  test('explains that the next Ooty departure strands the traveller at Tirupur until 04:30', async () => {
    const result = await findLastSafeDeparture(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      arriveBy: '2026-08-17T08:00:00Z',
    });

    expect(result.breakExplanation).toBeTruthy();
    expect(result.breakExplanation).toContain('TIRUPUR_NEW_STAND');
  });

  test('reports not found when no chain can meet the deadline', async () => {
    const result = await findLastSafeDeparture(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      arriveBy: '2026-08-16T18:00:00Z', // impossibly early
    });
    expect(result.found).toBe(false);
    expect(result.breakExplanation).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/engine/lastSafeDeparture.test.ts`
Expected: FAIL with "Cannot find module './lastSafeDeparture'"

- [ ] **Step 3: Implement**

`src/engine/lastSafeDeparture.ts`:

**Why this is more than a reversed forward search:** reusing `earliestArrival` on a time-reversed graph finds the latest departure that is merely *feasible* — reaches the destination by the deadline via *any* chain, including one that waits out an unsafe stretch overnight at a stop with no facilities. With a daily-repeating calendar, a later-but-worse departure can "technically" arrive by the deadline via an overnight wait and so would incorrectly win over the genuinely safe answer. `findLastSafeDeparture` therefore treats a long wait (≥180 minutes — every real transfer in this corridor is under 65 minutes, so this threshold has wide margin) at a stop that isn't `safeOvernight` as disqualifying, and retries the backward search excluding that departure until it finds one with no such stranding.

```ts
import { eq } from 'drizzle-orm';
import type { createDb } from '../db/client';
import { stops } from '../db/schema';
import { loadConnections } from './loadConnections';
import { earliestArrival } from './connectionScan';
import { buildLegsWithConfidence } from './search';
import { resolveStopId, dateRangeFrom, worstBand } from './shared';
import type { Connection, TransferEdge, JourneyLeg, ConfidenceBand } from './types';

export interface FindLastSafeDepartureInput {
  origin: string;
  destination: string;
  arriveBy: string;
  maxLegs?: number;
  horizonDays?: number;
}

export interface LastSafeDepartureResult {
  found: boolean;
  legs: JourneyLeg[];
  overallConfidence: ConfidenceBand | null;
  breakExplanation: string | null;
}

// Comfortably larger than any realistic absolute-minute value so reversal never
// produces a negative number in this project's lifetime.
const REVERSAL_ANCHOR = 10_000_000_000;

// A wait this long or longer, at a stop that isn't marked safe overnight,
// disqualifies a candidate departure — it's "feasible" but not "safe".
const UNSAFE_WAIT_THRESHOLD_MINUTES = 180;
const MAX_SAFETY_RETRIES = 10;

function reverseConnection(c: Connection): Connection {
  return {
    ...c,
    fromStopId: c.toStopId,
    toStopId: c.fromStopId,
    departureAbsMin: REVERSAL_ANCHOR - c.arrivalAbsMin,
    arrivalAbsMin: REVERSAL_ANCHOR - c.departureAbsMin,
  };
}

function reverseTransfer(t: TransferEdge): TransferEdge {
  return { fromStopId: t.toStopId, toStopId: t.fromStopId, minTransferMinutes: t.minTransferMinutes };
}

async function isUnsafeOvernightWait(
  db: ReturnType<typeof createDb>,
  stopId: string,
  waitMinutes: number,
): Promise<boolean> {
  if (waitMinutes < UNSAFE_WAIT_THRESHOLD_MINUTES) return false;
  const [stop] = await db.select().from(stops).where(eq(stops.stopId, stopId));
  return stop?.safeOvernight !== true;
}

/** Whether any transfer in this leg chain strands the traveller unsafely. */
async function hasUnsafeStranding(
  db: ReturnType<typeof createDb>,
  legs: Connection[],
): Promise<boolean> {
  for (let i = 0; i < legs.length - 1; i++) {
    const waitMinutes = legs[i + 1].departureAbsMin - legs[i].arrivalAbsMin;
    // The wait is spent at the boarding stop of the next leg (after any
    // cross-stand transfer is done), not the alighting stop of this one.
    if (await isUnsafeOvernightWait(db, legs[i + 1].fromStopId, waitMinutes)) {
      return true;
    }
  }
  return false;
}

export async function findLastSafeDeparture(
  db: ReturnType<typeof createDb>,
  input: FindLastSafeDepartureInput,
): Promise<LastSafeDepartureResult> {
  const originStopId = await resolveStopId(db, input.origin);
  const destinationStopId = await resolveStopId(db, input.destination);
  const deadlineAbsMin = Date.parse(input.arriveBy) / 60000;
  const dates = dateRangeFrom(input.arriveBy, -(input.horizonDays ?? 3));

  const { connections, transferEdges } = await loadConnections(db, dates);
  const excludedTripIds = new Set<string>();

  for (let attempt = 0; attempt < MAX_SAFETY_RETRIES; attempt++) {
    const candidateConnections = connections.filter(
      (c) => !(c.fromStopId === originStopId && excludedTripIds.has(c.tripId)),
    );

    const reversedConnections = candidateConnections.map(reverseConnection);
    const reversedTransfers = transferEdges.map(reverseTransfer);
    const reversedStart = REVERSAL_ANCHOR - deadlineAbsMin;

    const scan = earliestArrival(
      reversedConnections,
      reversedTransfers,
      destinationStopId,
      originStopId,
      reversedStart,
      input.maxLegs ?? 4,
      5,
    );

    if (!scan.found) {
      return { found: false, legs: [], overallConfidence: null, breakExplanation: null };
    }

    // Reversing twice restores original direction and time; reversing the
    // array order un-does the "closest leg to destination first" traversal
    // order the backward scan naturally produces.
    const forwardLegs = scan.legs.map(reverseConnection).reverse();

    if (await hasUnsafeStranding(db, forwardLegs)) {
      excludedTripIds.add(forwardLegs[0].tripId);
      continue;
    }

    const legs = await buildLegsWithConfidence(forwardLegs, connections, transferEdges, db);
    const breakExplanation = await explainWhyLaterDeparturesFail(db, connections, transferEdges, forwardLegs);

    return {
      found: true,
      legs,
      overallConfidence: worstBand(legs.map((l) => l.confidence)),
      breakExplanation,
    };
  }

  return { found: false, legs: [], overallConfidence: null, breakExplanation: null };
}

/**
 * Finds the next real departure from the origin after the safe one, and
 * replays the same stop sequence forward to find exactly where it breaks —
 * either no connection exists at all, or one exists but only after an
 * unsafe overnight wait.
 */
async function explainWhyLaterDeparturesFail(
  db: ReturnType<typeof createDb>,
  connections: Connection[],
  transferEdges: TransferEdge[],
  safeLegs: Connection[],
): Promise<string | null> {
  const firstLeg = safeLegs[0];
  const nextDeparture = connections
    .filter((c) => c.fromStopId === firstLeg.fromStopId && c.toStopId === firstLeg.toStopId)
    .filter((c) => c.departureAbsMin > firstLeg.departureAbsMin)
    .sort((a, b) => a.departureAbsMin - b.departureAbsMin)[0];
  if (!nextDeparture) return null;

  let arrivalAtCurrentStop = nextDeparture.arrivalAbsMin;
  let currentStopId = nextDeparture.toStopId;

  for (let i = 1; i < safeLegs.length; i++) {
    const requiredLeg = safeLegs[i];
    const buffer =
      currentStopId === requiredLeg.fromStopId
        ? 5
        : (transferEdges.find((t) => t.fromStopId === currentStopId && t.toStopId === requiredLeg.fromStopId)
            ?.minTransferMinutes ?? Infinity);

    const nextOnCorridor = connections
      .filter((c) => c.fromStopId === requiredLeg.fromStopId && c.toStopId === requiredLeg.toStopId)
      .filter((c) => c.departureAbsMin >= arrivalAtCurrentStop + buffer)
      .sort((a, b) => a.departureAbsMin - b.departureAbsMin)[0];

    const waitMinutes = nextOnCorridor ? nextOnCorridor.departureAbsMin - arrivalAtCurrentStop : null;
    const strandedHere =
      !nextOnCorridor ||
      (waitMinutes !== null && (await isUnsafeOvernightWait(db, requiredLeg.fromStopId, waitMinutes)));

    if (strandedHere) {
      const nextText = nextOnCorridor
        ? `the next connection from there doesn't depart until ${formatAbsMin(nextOnCorridor.departureAbsMin)}`
        : 'no further connection was found in the search window';
      return `Leaving after ${formatAbsMin(firstLeg.departureAbsMin)} instead: you would reach ${currentStopId} at ${formatAbsMin(arrivalAtCurrentStop)}, too late for the ${formatAbsMin(requiredLeg.departureAbsMin)} connection from ${requiredLeg.fromStopId} — ${nextText}.`;
    }

    arrivalAtCurrentStop = nextOnCorridor!.arrivalAbsMin;
    currentStopId = nextOnCorridor!.toStopId;
  }

  return null;
}

function formatAbsMin(absMin: number): string {
  return new Date(absMin * 60000).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/engine/lastSafeDeparture.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/lastSafeDeparture.ts src/engine/lastSafeDeparture.test.ts
git commit -m "feat: backward search for Last Safe Departure with a break explanation"
```

---

### Task 11: LLM tool layer

**Files:**
- Create: `src/llm/tools.ts`
- Create: `src/llm/agent.ts`
- Test: `src/llm/tools.test.ts`
- Test: `src/llm/agent.test.ts`

**Interfaces:**
- Consumes: `planJourney` (Task 9), `findLastSafeDeparture` (Task 10), `StopNotFoundError` (Task 9).
- Produces: `createJourneyTools(db)` returning `{ plan_journey, find_last_safe_departure }` AI SDK tools; `createJourneyAgent(db)` returning a configured `ToolLoopAgent`.

- [ ] **Step 1: Write the failing test for the tools**

`src/llm/tools.test.ts`:
```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../db/testDb';
import { ingestDemoCorridor } from '../ingest/demoCorridor';
import { createJourneyTools } from './tools';

describe('journey tools', () => {
  const db = setupTestDb();
  const tools = createJourneyTools(db);

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
  });

  test('plan_journey returns a structured plan and a narration, called directly as a function', async () => {
    const output = await tools.plan_journey.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', departAfter: '2026-08-16T15:00:00Z', maxLegs: 4 },
      { toolCallId: 'test', messages: [] } as any,
    );

    expect(output.plan.found).toBe(true);
    expect(output.plan.legs.map((l: any) => l.tripId)).toEqual(['OOTY_MTP_A', 'MTP_TPR_A', 'TPR_MDU_LAST', 'MDU_SVP_LAST']);
    expect(typeof output.narration).toBe('string');
    expect(output.narration.length).toBeGreaterThan(0);
  });

  test('find_last_safe_departure returns the safe plan and a break explanation', async () => {
    const output = await tools.find_last_safe_departure.execute!(
      { origin: 'OOTY_STAND', destination: 'SRIVILLIPUTHUR_STAND', arriveBy: '2026-08-17T08:00:00Z', maxLegs: 4 },
      { toolCallId: 'test', messages: [] } as any,
    );

    expect(output.plan.found).toBe(true);
    expect(output.plan.breakExplanation).toContain('TIRUPUR_NEW_STAND');
    expect(output.narration).toContain('OOTY_MTP_A');
  });

  test('an unknown stop name returns a no-data response instead of throwing', async () => {
    const output = await tools.plan_journey.execute!(
      { origin: 'NOWHERE_MADE_UP', destination: 'SRIVILLIPUTHUR_STAND', departAfter: '2026-08-16T15:00:00Z', maxLegs: 4 },
      { toolCallId: 'test', messages: [] } as any,
    );
    expect(output.plan).toBeNull();
    expect(output.narration).toContain('NOWHERE_MADE_UP');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/llm/tools.test.ts`
Expected: FAIL with "Cannot find module './tools'"

- [ ] **Step 3: Implement `src/llm/tools.ts`**

```ts
import { z } from 'zod';
import { tool } from 'ai';
import type { createDb } from '../db/client';
import { planJourney } from '../engine/search';
import { findLastSafeDeparture } from '../engine/lastSafeDeparture';
import { StopNotFoundError } from '../engine/shared';
import type { JourneyPlanResult } from '../engine/types';
import type { LastSafeDepartureResult } from '../engine/lastSafeDeparture';

export function createJourneyTools(db: ReturnType<typeof createDb>) {
  return {
    plan_journey: tool({
      description: 'Find viable multi-leg bus journeys between two named stops, departing after a given time.',
      inputSchema: z.object({
        origin: z.string().describe('Origin stop name'),
        destination: z.string().describe('Destination stop name'),
        departAfter: z.string().describe('ISO 8601 datetime — do not depart before this'),
        maxLegs: z.number().int().min(1).max(6).default(4),
      }),
      execute: async ({ origin, destination, departAfter, maxLegs }) => {
        try {
          const plan = await planJourney(db, { origin, destination, departAfter, maxLegs });
          return { plan, narration: narratePlan(plan) };
        } catch (error) {
          if (error instanceof StopNotFoundError) {
            return { plan: null, narration: `I don't have "${error.query}" in the ledger yet.` };
          }
          throw error;
        }
      },
    }),
    find_last_safe_departure: tool({
      description: 'Given a required arrival time, return the latest departure that still arrives safely, plus why later options fail.',
      inputSchema: z.object({
        origin: z.string(),
        destination: z.string(),
        arriveBy: z.string().describe('ISO 8601 datetime — must arrive at or before this'),
        maxLegs: z.number().int().min(1).max(6).default(4),
      }),
      execute: async ({ origin, destination, arriveBy, maxLegs }) => {
        try {
          const plan = await findLastSafeDeparture(db, { origin, destination, arriveBy, maxLegs });
          return { plan, narration: narrateLastSafeDeparture(plan) };
        } catch (error) {
          if (error instanceof StopNotFoundError) {
            return { plan: null, narration: `I don't have "${error.query}" in the ledger yet.` };
          }
          throw error;
        }
      },
    }),
  };
}

function narratePlan(plan: JourneyPlanResult): string {
  if (!plan.found) return 'No route was found in the schedule for that request.';
  const steps = plan.legs.map((l) => `${l.tripId} from ${l.fromStopId} to ${l.toStopId}`).join(', then ');
  return `Take: ${steps}. Overall confidence: ${plan.overallConfidence}.`;
}

function narrateLastSafeDeparture(plan: LastSafeDepartureResult): string {
  if (!plan.found) return 'No journey in the schedule reaches the destination by that time.';
  const first = plan.legs[0];
  const base = `Last safe departure is ${first.tripId} from ${first.fromStopId}.`;
  return plan.breakExplanation ? `${base} ${plan.breakExplanation}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/llm/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the agent**

`src/llm/agent.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { createDb } from '../db/client';
import { createJourneyAgent } from './agent';

describe('createJourneyAgent', () => {
  test('throws a clear error when OPENAI_API_KEY is not set', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => createJourneyAgent(createDb('postgresql://unused'))).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test('constructs successfully once a key is present (no live call is made)', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
    try {
      expect(() => createJourneyAgent(createDb('postgresql://unused'))).not.toThrow();
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test src/llm/agent.test.ts`
Expected: FAIL with "Cannot find module './agent'"

- [ ] **Step 7: Implement `src/llm/agent.ts`**

```ts
import { ToolLoopAgent } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { createDb } from '../db/client';
import { createJourneyTools } from './tools';

const SYSTEM_PROMPT = `You are VazhiKaatti, a journey-planning assistant for Indian intercity bus travel.

Rules you must never break:
- You may only state a schedule fact (a time, a stop, a confidence level) if it came from a tool result in this conversation. If no tool returned the data, say so plainly and suggest the nearest thing you do know — never estimate or invent a timing.
- Reply in whatever language or mix of languages the user wrote in (Tamil, English, or code-mixed) — match them, don't force English.
- When a plan includes a "tight" or "risky" connection, say so plainly and explain why, using the tool's own confidence reasons — don't soften it.`;

function requireOpenAiKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. The journey engine and tools work without it (see src/engine ' +
        'and src/llm/tools.ts), but the conversational agent needs a key before it can run — set ' +
        'OPENAI_API_KEY in .env.local to enable it.',
    );
  }
}

export function createJourneyAgent(db: ReturnType<typeof createDb>) {
  requireOpenAiKey();
  return new ToolLoopAgent({
    model: openai(process.env.OPENAI_MODEL ?? 'gpt-5.5'),
    instructions: SYSTEM_PROMPT,
    tools: createJourneyTools(db),
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test src/llm/agent.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full test suite**

Run: `bun test`
Expected: all tests across every task PASS.

- [ ] **Step 10: Commit**

```bash
git add src/llm/
git commit -m "feat: wire the two journey tools into a ToolLoopAgent"
```

---

## Self-Review

**Spec coverage:**
- §3 Environments & persistence → Task 1 (local dev/test Postgres, Drizzle; Neon is explicitly deferred to deployment, not this plan).
- §4 Schema (this phase) → Task 2 (all 11 tables; booking/journey_plans deliberately absent).
- §5 Seed data → Tasks 3-6 (parsing, real CSV import, synthetic corridor, CLI).
- §6 Journey engine (search.ts, confidence.ts, lastSafeDeparture.ts) → Tasks 7-10.
- §7 LLM tool layer → Task 11.
- §8 Error handling → "no route" returns (not throws) in Tasks 9-10; malformed-row rejection in Task 4; fail-fast missing-key in Task 11.
- §9 Testing → every task is TDD'd against the local test database; the exact worked example numbers are asserted in Tasks 9-10.

**Placeholder scan:** no TBD/TODO markers; every step has real code. The one "later phase" comment (search.ts confidence wiring) references a concrete, already-existing function (`getReliability`) that's actually called, not a stub.

**Type consistency:** `Connection`, `TransferEdge`, `JourneyLeg`, `JourneyPlanResult`, `ConfidenceBand` are defined once in `src/engine/types.ts` (Task 7) and imported everywhere else by those exact names. `buildLegsWithConfidence`'s signature (`scanLegs, allConnections, transferEdges, db`) is identical at its Task 9 definition and its Task 10 call site. `createDb`'s return type is threaded consistently as `ReturnType<typeof createDb>` throughout.

**Scope check:** this plan implements spec sections 1-9 (everything except §10's explicitly-deferred follow-on phases). It's appropriately one plan — every task builds toward one working, testable engine, not several independent subsystems.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-18-ledger-engine-tools.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
