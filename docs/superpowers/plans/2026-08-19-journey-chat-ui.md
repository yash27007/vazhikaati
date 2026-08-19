# Journey Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a natural-language chat UI (text + voice, multi-language) that lets a person ask "how do I get from Ooty to Srivilliputhur tonight?" and get back a conversational reply plus a structured journey plan, using the Tasks 1-11 engine and LLM tool layer already on this branch.

**Architecture:** Two Next.js API routes (`/api/chat` streams a `ToolLoopAgent`'s replies via the AI SDK's UI-message protocol; `/api/transcribe` turns recorded audio into text via OpenAI transcription) behind a single `/chat` page built from small React components (`useChat` for the conversation, a `JourneyPlanCard` that reads structured plan data straight out of the tool-result message parts). A `MOCK_LLM=true` env var swaps in a scripted `MockLanguageModelV4` — same tools, same route, same components — so the whole flow is verifiable without an OpenAI key.

**Tech Stack:** Next.js 16.3.1 (App Router), `ai` ^7.0.66, `@ai-sdk/openai` ^4.0.42, `@ai-sdk/react` ^4.0.71 (new), Tailwind v4, Drizzle/Postgres (existing).

**Spec:** `docs/superpowers/specs/2026-08-19-journey-chat-ui-design.md` — read it first; this plan argues from it. It in turn builds on `docs/superpowers/specs/2026-08-18-ledger-engine-tools-design.md`.

## Global Constraints

- Exactly two LLM tools: `plan_journey`, `find_last_safe_departure` — this plan adds no new tools, only a UI in front of the existing two.
- Every tool already returns a structured plan object **and** a short narration string — the UI must show both, not narration alone (per the original backend spec, still binding).
- Language handling is system-prompt only — no separate detection/translation step; this plan's transcription language picker is about *speech-to-text* accuracy, not translation, and must not be conflated with the agent's own language handling.
- No placeholder/guessed OpenAI model IDs — `OPENAI_TRANSCRIBE_MODEL` (new, this plan) and the existing `OPENAI_MODEL` both read from env vars with a documented default, never hardcoded without an override.
- All wall-clock times in this system are IST (Asia/Kolkata) — this plan's Task 1 makes that true at the source; every later task that displays a time uses the resulting `departureLocal`/`arrivalLocal`/`formatIstDateTime` output, never a raw `Date.parse`/`toISOString()` on an abs-minute value.
- No server-side persistence added by this plan (chat history is `localStorage`-only) — matches the backend's own "nothing is persisted" stance.
- Personal/local tool for now — no auth, no rate limiting on the new routes.
- Do not include a "Co-Authored-By: Claude" trailer in any commit — this repo's owner has opted out of that attribution.

---

### Task 1: Anchor engine time arithmetic to IST

**Files:**
- Modify: `src/engine/shared.ts`
- Modify: `src/engine/loadConnections.ts`
- Modify: `src/engine/search.ts` (one line: the `Date.parse` call)
- Modify: `src/engine/lastSafeDeparture.ts` (one line: the `Date.parse` call)
- Test: `src/engine/shared.test.ts`
- Test: `src/engine/loadConnections.test.ts`
- Test: `src/engine/search.test.ts` (existing datetime literals updated)
- Test: `src/engine/lastSafeDeparture.test.ts` (existing datetime literals updated)
- Test: `src/llm/tools.test.ts` (existing datetime literals updated)

**Interfaces:**
- Produces: `IST_OFFSET_MINUTES: number`, `parseIstDateTime(isoDateTime: string): number` (epoch ms), `istCalendarDate(absMin: number): string` (`YYYY-MM-DD`), `formatIstTime(absMin: number): string` (`HH:MM`), `formatIstDateTime(absMin: number): string` (`YYYY-MM-DD HH:MM IST`) — all exported from `src/engine/shared.ts`, consumed by Task 2 and by `src/engine/lastSafeDeparture.ts`.

Why this task exists: `loadConnections.ts` currently anchors every connection's abs-minute value to **UTC** midnight, so a scheduled "15:40" is silently stored as 21:10 IST. `search.ts`/`lastSafeDeparture.ts` parse a caller's `departAfter`/`arriveBy` with bare `Date.parse`, which — for a datetime string with no explicit offset — Node/Bun interpret using the *process's local timezone*, not a fixed one. Both problems get fixed by treating every offset-less datetime as IST, consistently, everywhere.

- [ ] **Step 1: Write the failing tests for the new shared.ts helpers**

Append to `src/engine/shared.test.ts` (new `describe` block, same file, existing `resolveStopId` tests untouched):

```ts
import { parseIstDateTime, istCalendarDate, formatIstTime, formatIstDateTime } from './shared';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/engine/shared.test.ts`
Expected: FAIL — `parseIstDateTime`, `istCalendarDate`, `formatIstTime`, `formatIstDateTime` are not exported from `./shared` yet.

- [ ] **Step 3: Implement the helpers in shared.ts**

Add to `src/engine/shared.ts` (keep the existing `resolveStopId`/`StopNotFoundError`/`slugify`/`worstBand`/`BAND_ORDER` unchanged; this only adds new exports and replaces `dateRangeFrom`'s body):

```ts
/** Minutes to add to a UTC instant to get its IST (Asia/Kolkata, UTC+5:30) wall-clock reading. */
export const IST_OFFSET_MINUTES = 330;

function hasExplicitOffset(isoDateTime: string): boolean {
  return /(Z|[+-]\d{2}:\d{2})$/.test(isoDateTime.trim());
}

/**
 * Parses an ISO 8601 datetime as IST when it carries no explicit timezone
 * offset. This project has one timezone that matters — it's an India bus
 * ledger — so an unqualified caller-supplied time (`departAfter`, `arriveBy`)
 * means IST, not whatever timezone the Node/Bun process happens to run in.
 * A string with an explicit offset (`Z`, `+05:30`, etc.) is respected as-is.
 * Returns the same thing `Date.parse` does: epoch milliseconds, or `NaN` for
 * an unparseable string.
 */
export function parseIstDateTime(isoDateTime: string): number {
  return Date.parse(hasExplicitOffset(isoDateTime) ? isoDateTime : `${isoDateTime}+05:30`);
}

/** Returns the `YYYY-MM-DD` IST calendar date an absolute-minute value falls on. */
export function istCalendarDate(absMin: number): string {
  return new Date((absMin + IST_OFFSET_MINUTES) * 60000).toISOString().slice(0, 10);
}

/** Renders an absolute-minute value as an `HH:MM` IST wall-clock time. */
export function formatIstTime(absMin: number): string {
  const ist = new Date((absMin + IST_OFFSET_MINUTES) * 60000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Renders an absolute-minute value as `YYYY-MM-DD HH:MM IST`, for messages spanning multiple days. */
export function formatIstDateTime(absMin: number): string {
  return `${istCalendarDate(absMin)} ${formatIstTime(absMin)} IST`;
}
```

Replace `dateRangeFrom`'s body (keep its exact exported signature and JSDoc comment) so it derives the search window from the IST calendar day the input falls on, not the UTC one:

```ts
export function dateRangeFrom(isoDateTime: string, days: number): string[] {
  const instantMs = parseIstDateTime(isoDateTime);
  const istInstant = new Date(instantMs + IST_OFFSET_MINUTES * 60000);
  const startDate = new Date(Date.UTC(istInstant.getUTCFullYear(), istInstant.getUTCMonth(), istInstant.getUTCDate()));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/engine/shared.test.ts`
Expected: PASS — all `resolveStopId` tests still pass (untouched), all 5 new IST-helper tests pass.

- [ ] **Step 5: Write the failing test for loadConnections' IST anchoring**

Add to `src/engine/loadConnections.test.ts`, inside the existing `describe('loadConnections', ...)` block, after the two existing tests:

```ts
  test('anchors an early-morning departure to the correct IST calendar day, not the UTC day', async () => {
    const { connections } = await loadConnections(db, ['2026-08-16']);
    const earlyDeparture = connections.find((c) => c.tripId === 'TPR_MDU_EARLY');
    expect(earlyDeparture).toBeDefined();
    // TPR_MDU_EARLY departs at minute 270 (04:30 IST) on 2026-08-16. That
    // instant is 2026-08-15T23:00:00Z in UTC — if this were still anchored
    // to UTC midnight (the bug this task fixes), it would instead land on
    // 2026-08-16T04:30:00.000Z.
    expect(new Date(earlyDeparture!.departureAbsMin * 60000).toISOString()).toBe('2026-08-15T23:00:00.000Z');
  });
```

Also fix the existing `'produces comparable absolute times across two different dates'` test — its date lookup (`.toISOString().startsWith('2026-08-16')`) assumes UTC-anchored abs-minutes and will silently find the wrong connections (or `undefined`) once the anchor moves to IST for an early-morning trip. Replace its body:

```ts
  test('produces comparable absolute times across two different dates', async () => {
    const { connections } = await loadConnections(db, ['2026-08-16', '2026-08-17']);
    const day1 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && istCalendarDate(c.departureAbsMin) === '2026-08-16');
    const day2 = connections.find((c) => c.tripId === 'TPR_MDU_EARLY' && istCalendarDate(c.departureAbsMin) === '2026-08-17');
    expect(day1).toBeDefined();
    expect(day2).toBeDefined();
    expect(day2!.departureAbsMin - day1!.departureAbsMin).toBe(24 * 60);
  });
```

Add the import at the top of the file: `import { istCalendarDate } from './shared';`

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun test src/engine/loadConnections.test.ts`
Expected: FAIL — the new early-morning test fails because `loadConnections` still anchors to UTC (`absoluteMinutes` unmodified so far), and the rewritten day1/day2 test may also fail or find the wrong rows for the same reason.

- [ ] **Step 7: Fix loadConnections.ts's anchor**

In `src/engine/loadConnections.ts`, replace the `absoluteMinutes` function:

```ts
function absoluteMinutes(dateStr: string, minutesPastMidnight: number): number {
  // IST (UTC+5:30) midnight of dateStr — see shared.ts for why this project
  // anchors every wall-clock time to IST, not UTC.
  return Date.parse(`${dateStr}T00:00:00+05:30`) / 60000 + minutesPastMidnight;
}
```

Leave `isServiceActiveOn` and everything else in the file unchanged — the weekday lookup operates on the pure calendar-date string, which this fix doesn't touch.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test src/engine/loadConnections.test.ts`
Expected: PASS — all 3 tests (2 existing, 1 new) pass.

- [ ] **Step 9: Point search.ts and lastSafeDeparture.ts at parseIstDateTime**

In `src/engine/search.ts`, change the import line and the one `Date.parse` call:

```ts
import { resolveStopId, dateRangeFrom, worstBand, parseIstDateTime } from './shared';
```

```ts
  const startAbsMin = parseIstDateTime(input.departAfter) / 60000;
```

In `src/engine/lastSafeDeparture.ts`, change the import line and the one `Date.parse` call:

```ts
import { resolveStopId, dateRangeFrom, worstBand, parseIstDateTime, formatIstDateTime } from './shared';
```

```ts
  const deadlineAbsMin = parseIstDateTime(input.arriveBy) / 60000;
```

Also replace the file's own `formatAbsMin` helper — delete its current body (raw `toISOString()`) and its definition entirely, and replace both call sites (`formatAbsMin(...)`) with `formatIstDateTime(...)` instead, so `explainWhyLaterDeparturesFail`'s message reads real IST wall-clock times instead of raw UTC ISO strings. The two call sites are inside the template-literal `return` statement of `explainWhyLaterDeparturesFail`; the function body and its logic are otherwise unchanged.

- [ ] **Step 10: Update the existing engine tests' datetime literals to IST**

These datetime strings currently carry an explicit `Z` (UTC) suffix, which — after this task's fix — means something different than intended (a UTC instant, not the IST wall-clock time the test's own name/comment describes). Drop the trailing `Z` from each so the same literal digits are now interpreted as IST, which is what every test was actually trying to say. This is a pure text edit — the relative math between "deadline" and "connections" is unaffected by a uniform anchor shift, so no other test values change.

In `src/engine/search.test.ts`, on all 4 occurrences: change `'2026-08-16T15:00:00Z'` → `'2026-08-16T15:00:00'`, and `'2026-08-16T18:00:00Z'` → `'2026-08-16T18:00:00'`.

In `src/engine/lastSafeDeparture.test.ts`, on all 3 occurrences: change `'2026-08-17T08:00:00Z'` → `'2026-08-17T08:00:00'`, and `'2019-12-30T00:00:00Z'` → `'2019-12-30T00:00:00'` (still comfortably before the calendar's 2020-01-01 `startDate` either way — this drop is for consistency, not required by the test's own logic).

In `src/llm/tools.test.ts`, on all 3 occurrences: change `'2026-08-16T15:00:00Z'` → `'2026-08-16T15:00:00'`, and `'2026-08-17T08:00:00Z'` → `'2026-08-17T08:00:00'`.

- [ ] **Step 11: Run the full test suite**

Run: `bun test`
Expected: PASS — all tests across every file, including the ones just edited.

- [ ] **Step 12: Commit**

```bash
git add src/engine/shared.ts src/engine/shared.test.ts src/engine/loadConnections.ts src/engine/loadConnections.test.ts src/engine/search.ts src/engine/search.test.ts src/engine/lastSafeDeparture.ts src/engine/lastSafeDeparture.test.ts src/llm/tools.test.ts
git commit -m "fix: anchor all engine wall-clock times to IST instead of UTC

loadConnections.ts anchored every scheduled time to UTC midnight, so a
timetabled 15:40 was silently stored as 21:10 IST. search.ts and
lastSafeDeparture.ts parsed caller-supplied deadlines with bare
Date.parse, which for an offset-less string depends on the running
process's local timezone rather than a fixed one. Both are now IST
(Asia/Kolkata) consistently, via new parseIstDateTime/istCalendarDate/
formatIstTime/formatIstDateTime helpers in shared.ts.

The fix is a uniform shift applied to both sides of every comparison
(connections and caller deadlines alike), so existing tests' relative
behavior (which trip is picked, which band is scored) is unchanged —
only their datetime literals' trailing Z is dropped, since they now
mean IST rather than UTC. loadConnections.test.ts's day-lookup test
needed a real fix, not just a literal edit: converting an early-morning
IST departure to a UTC ISO string and checking its date prefix breaks
once the two calendars can disagree, which is exactly the bug class
this task fixes."
```

---

### Task 2: Human-readable stop names and local times on JourneyLeg

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/search.ts` (`buildLegsWithConfidence`)
- Modify: `src/llm/tools.ts` (`narratePlan`, `narrateLastSafeDeparture`)
- Test: `src/engine/search.test.ts`
- Test: `src/llm/tools.test.ts`

**Interfaces:**
- Consumes: `formatIstTime(absMin): string` (Task 1, `./shared`).
- Produces: `JourneyLeg` gains 4 new fields — `fromStopName: string`, `toStopName: string`, `departureLocal: string`, `arrivalLocal: string` — consumed by Task 6 (`JourneyPlanCard`).

- [ ] **Step 1: Write the failing test**

Add to `src/engine/search.test.ts`, inside the existing `describe('planJourney', ...)` block:

```ts
  test('legs carry human-readable stop names and IST local times', async () => {
    const result = await planJourney(db, {
      origin: 'OOTY_STAND',
      destination: 'SRIVILLIPUTHUR_STAND',
      departAfter: '2026-08-16T15:00:00',
    });

    const firstLeg = result.legs[0];
    expect(firstLeg.fromStopName).toBe('Ooty Bus Stand');
    expect(firstLeg.toStopName).toBe('Mettupalayam Bus Stand');
    expect(firstLeg.departureLocal).toBe('15:40');
    expect(firstLeg.arrivalLocal).toBe('17:10');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/engine/search.test.ts`
Expected: FAIL — `firstLeg.fromStopName` is `undefined`, `JourneyLeg` has no such field yet.

- [ ] **Step 3: Add the fields to JourneyLeg**

In `src/engine/types.ts`, add 4 fields to the `JourneyLeg` interface (keep every existing field exactly as-is):

```ts
export interface JourneyLeg {
  tripId: string;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  fromStopName: string;
  toStopName: string;
  departureAbsMin: number;
  arrivalAbsMin: number;
  departureLocal: string;
  arrivalLocal: string;
  dataTier: number;
  confidence: ConfidenceBand;
  confidenceReasons: string[];
}
```

- [ ] **Step 4: Populate the new fields in buildLegsWithConfidence**

In `src/engine/search.ts`, add imports:

```ts
import { inArray } from 'drizzle-orm';
import { stops } from '../db/schema';
import { resolveStopId, dateRangeFrom, worstBand, parseIstDateTime, formatIstTime } from './shared';
```

(This replaces the existing `import { resolveStopId, dateRangeFrom, worstBand } from './shared';` line with the same names plus `parseIstDateTime, formatIstTime` — `parseIstDateTime` was already added in Task 1's Step 9; this step just also adds `formatIstTime`.)

At the top of `buildLegsWithConfidence`, before the `for` loop, batch-resolve every stop name in one query:

```ts
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
```

Then, in the `legs.push({...})` call at the end of the loop, add the 4 new fields (keep every existing field):

```ts
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
```

The `?? leg.fromStopId`/`?? leg.toStopId` fallback is defensive only — every `stopId` referenced by a connection has a real row via the `stop_times`/`stops` foreign key, so the map lookup should never actually miss.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/engine/search.test.ts`
Expected: PASS — including the new test and every existing one (the existing tests don't assert on the new fields, so they're unaffected by their presence).

- [ ] **Step 6: Write the failing test for narration text**

Update the two narration-related assertions in `src/llm/tools.test.ts` — in the `'plan_journey returns a structured plan and a narration...'` test, add after the existing `expect(output.narration.length).toBeGreaterThan(0);` line:

```ts
    expect(output.narration).toContain('Ooty Bus Stand');
    expect(output.narration).toContain('15:40');
```

In the `'find_last_safe_departure returns the safe plan and a break explanation'` test, add after the existing `expect(output.narration).toContain('OOTY_MTP_A');` line:

```ts
    expect(output.narration).toContain('Ooty Bus Stand');
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `bun test src/llm/tools.test.ts`
Expected: FAIL — `narratePlan`/`narrateLastSafeDeparture` still build their strings from `fromStopId`/`toStopId`, not the new name fields, so `'Ooty Bus Stand'` never appears in the narration.

- [ ] **Step 8: Update the narration functions**

In `src/llm/tools.ts`, replace both narration functions:

```ts
function narratePlan(plan: JourneyPlanResult): string {
  if (!plan.found) return 'No route was found in the schedule for that request.';
  const steps = plan.legs
    .map((l) => `${l.tripId} from ${l.fromStopName} (${l.departureLocal}) to ${l.toStopName} (${l.arrivalLocal})`)
    .join(', then ');
  return `Take: ${steps}. Overall confidence: ${plan.overallConfidence}.`;
}

function narrateLastSafeDeparture(plan: LastSafeDepartureResult): string {
  if (!plan.found) return 'No journey in the schedule reaches the destination by that time.';
  const first = plan.legs[0];
  const base = `Last safe departure is ${first.tripId} from ${first.fromStopName} at ${first.departureLocal}.`;
  return plan.breakExplanation ? `${base} ${plan.breakExplanation}` : base;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun test src/llm/tools.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite**

Run: `bun test`
Expected: PASS, all files.

- [ ] **Step 11: Commit**

```bash
git add src/engine/types.ts src/engine/search.ts src/engine/search.test.ts src/llm/tools.ts src/llm/tools.test.ts
git commit -m "feat: add human-readable stop names and local times to JourneyLeg

JourneyLeg previously exposed only internal stop IDs (OOTY_STAND) and
raw epoch-minute values — nothing a person could read directly. Adds
fromStopName/toStopName (resolved from stops.name in one batched query)
and departureLocal/arrivalLocal (IST HH:MM, via Task 1's formatIstTime)
to what buildLegsWithConfidence returns. Updates the two tools' own
narration strings to use the new fields too, so the agent's replies
read as 'Ooty Bus Stand (15:40)' instead of 'OOTY_STAND'."
```

---

### Task 3: Add @ai-sdk/react and the /api/chat route (with mock mode)

**Files:**
- Modify: `package.json`, `bun.lock` (add `@ai-sdk/react`)
- Create: `src/app/api/chat/route.ts`
- Create: `src/app/api/chat/mockAgent.ts`
- Test: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: `createJourneyAgent(db)` (`src/llm/agent.ts`, Task 11), `createJourneyTools(db)` (`src/llm/tools.ts`, Task 11).
- Produces: `POST /api/chat` route handler, consumed by Task 5's `ChatWindow` via `useChat`. `createMockJourneyAgent(db)` from `mockAgent.ts`, used only by this route.

- [ ] **Step 1: Add the dependency**

```bash
bun add @ai-sdk/react@^4.0.71
```

- [ ] **Step 2: Write the failing test**

Create `src/app/api/chat/route.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupTestDb, truncateAll } from '../../../db/testDb';
import { ingestDemoCorridor } from '../../../ingest/demoCorridor';
import { db as prodDb } from '../../../db/client';
import { POST } from './route';

// The route handler reads the module-level `db` from src/db/client.ts, so
// these tests point that same connection at the disposable test database
// via DATABASE_URL_TEST — setupTestDb() already does this for every other
// engine/tools test in this project.
describe('POST /api/chat (mock mode)', () => {
  const db = setupTestDb();

  beforeEach(async () => {
    await truncateAll(db);
    await ingestDemoCorridor(db);
    process.env.MOCK_LLM = 'true';
  });

  test('a recognized demo query streams back the real demo-corridor plan', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { id: '1', role: 'user', parts: [{ type: 'text', text: 'How do I get from Ooty to Srivilliputhur?' }] },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const text = await response.text();
    // The SSE stream carries the tool's JSON-serialized output somewhere in
    // its body — check for the real, engine-produced tripId chain rather
    // than parsing the full SSE protocol.
    expect(text).toContain('OOTY_MTP_A');
    expect(text).toContain('MTP_TPR_A');
    expect(text).toContain('TPR_MDU_LAST');
    expect(text).toContain('MDU_SVP_LAST');
  });

  test('an unrecognized query gets the canned no-real-data reply, not a crash', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'What is the capital of France?' }] }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).toContain('mock_llm');
  });
});
```

Note: this test relies on the route handler using the same `db` connection `setupTestDb()`/`truncateAll()` point at `DATABASE_URL_TEST` — Step 4 below imports `db` from `src/db/client.ts` directly (the same module this test imports as `prodDb`), so setting `DATABASE_URL_TEST` env before the test run (already required by every other test in this project, per `.env`/`.env.example`) makes them the same connection. `prodDb` is imported only to make that coupling explicit for a reader; it isn't called directly in the test.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/app/api/chat/route.test.ts`
Expected: FAIL — `src/app/api/chat/route.ts` does not exist yet.

- [ ] **Step 4: Implement the mock agent**

Create `src/app/api/chat/mockAgent.ts`:

```ts
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import type { createDb } from '../../../db/client';
import { createJourneyTools } from '../../../llm/tools';

// A fixed IST departure that reproduces the demo corridor's canonical worked
// example (OOTY_MTP_A -> MTP_TPR_A -> TPR_MDU_LAST -> MDU_SVP_LAST) — the
// same fixture datetime used throughout src/engine/search.test.ts.
const DEMO_DEPART_AFTER = '2026-08-16T15:00:00';

function looksLikeDemoQuery(promptText: string): boolean {
  const lower = promptText.toLowerCase();
  return lower.includes('ooty') && (lower.includes('srivilliputhur') || lower.includes('svp'));
}

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
} as const;

/**
 * A ToolLoopAgent whose LANGUAGE MODEL is scripted (MockLanguageModelV4) but
 * whose TOOLS are the real createJourneyTools(db) — a recognized query
 * genuinely calls plan_journey against the real database's demo-corridor
 * data. This exercises the actual engine/tool wiring end to end without any
 * OpenAI call, for local verification with no API key. Only ONE tool call
 * is ever scripted (plan_journey) — this is a smoke test of the plumbing,
 * not a general-purpose fake LLM.
 */
export function createMockJourneyAgent(db: ReturnType<typeof createDb>) {
  let step = 0;
  const toolCallId = 'mock-tool-call-1';

  const model = new MockLanguageModelV4({
    modelId: 'mock-journey-model',
    doStream: async ({ prompt }) => {
      step += 1;
      const promptText = JSON.stringify(prompt);

      if (step === 1 && looksLikeDemoQuery(promptText)) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId,
                toolName: 'plan_journey',
                input: JSON.stringify({
                  origin: 'Ooty',
                  destination: 'Srivilliputhur',
                  departAfter: DEMO_DEPART_AFTER,
                  maxLegs: 4,
                }),
              },
              { type: 'finish', finishReason: 'tool-calls', usage: ZERO_USAGE },
            ],
          }),
        };
      }

      if (step > 1) {
        // Follow-up step after the tool result came back — summarize in text.
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'summary' },
              { type: 'text-delta', id: 'summary', delta: 'Here is the demo journey plan (MOCK_LLM mode — no real model was called).' },
              { type: 'text-end', id: 'summary' },
              { type: 'finish', finishReason: 'stop', usage: ZERO_USAGE },
            ],
          }),
        };
      }

      // step === 1 and not a recognized query.
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'unrecognized' },
            {
              type: 'text-delta',
              id: 'unrecognized',
              delta:
                "MOCK_LLM is on — I only recognize a demo Ooty-to-Srivilliputhur query right now, not a live model. " +
                'Ask about travelling from Ooty to Srivilliputhur to see the real demo-corridor plan.',
            },
            { type: 'text-end', id: 'unrecognized' },
            { type: 'finish', finishReason: 'stop', usage: ZERO_USAGE },
          ],
        }),
      };
    },
  });

  return new ToolLoopAgent({
    model,
    instructions: 'Mock agent for local development — scripted responses only, see src/app/api/chat/mockAgent.ts.',
    tools: createJourneyTools(db),
  });
}
```

If `bunx tsc --noEmit` flags the `usage`/chunk object shapes as missing an optional field `MockLanguageModelV4`'s installed types require, add exactly the field(s) it names — the shapes above are grounded in the installed `@ai-sdk/provider`'s `LanguageModelV4StreamPart`/`LanguageModelV4Usage` types (verified by reading `node_modules/@ai-sdk/provider/dist/index.d.ts` directly), but a patch version could add a new required field after this plan was written.

- [ ] **Step 5: Implement the route handler**

Create `src/app/api/chat/route.ts`:

```ts
import { createAgentUIStreamResponse } from 'ai';
import { db } from '../../../db/client';
import { createJourneyAgent } from '../../../llm/agent';
import { createMockJourneyAgent } from './mockAgent';

export async function POST(request: Request) {
  const { messages } = await request.json();

  const agent = process.env.MOCK_LLM === 'true' ? createMockJourneyAgent(db) : createJourneyAgent(db);

  return createAgentUIStreamResponse({ agent, uiMessages: messages });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test src/app/api/chat/route.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `bun test`
Expected: PASS, all files.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock src/app/api/chat/route.ts src/app/api/chat/mockAgent.ts src/app/api/chat/route.test.ts
git commit -m "feat: add POST /api/chat route streaming the journey agent, with a mock mode

Wraps the existing createJourneyAgent (Task 11) in createAgentUIStreamResponse
so useChat can drive it directly. MOCK_LLM=true swaps in a
MockLanguageModelV4-backed agent that still uses the real
createJourneyTools(db) — a recognized Ooty-to-Srivilliputhur query
genuinely calls plan_journey against real demo-corridor data, so the
whole flow is verifiable with no OpenAI key and no cost."
```

---

### Task 4: The /api/transcribe route (with mock mode)

**Files:**
- Create: `src/app/api/transcribe/route.ts`
- Test: `src/app/api/transcribe/route.test.ts`

**Interfaces:**
- Produces: `POST /api/transcribe` route handler, consumed by Task 7's `MicButton`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/transcribe/route.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { POST } from './route';

describe('POST /api/transcribe (mock mode)', () => {
  beforeEach(() => {
    process.env.MOCK_LLM = 'true';
  });

  test('returns a canned transcript without calling any transcription API', async () => {
    const formData = new FormData();
    formData.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'clip.webm');

    const request = new Request('http://localhost/api/transcribe', { method: 'POST', body: formData });
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
  });

  test('rejects a request with no audio field', async () => {
    const formData = new FormData();
    const request = new Request('http://localhost/api/transcribe', { method: 'POST', body: formData });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/app/api/transcribe/route.test.ts`
Expected: FAIL — `src/app/api/transcribe/route.ts` does not exist yet.

- [ ] **Step 3: Implement the route handler**

Create `src/app/api/transcribe/route.ts`:

```ts
import { transcribe } from 'ai';
import { openai } from '@ai-sdk/openai';

const MOCK_TRANSCRIPT = 'When is the next bus from Ooty to Srivilliputhur tonight?';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('audio');
  const language = formData.get('language');
  const languageOverride = typeof language === 'string' && language.length > 0 ? language : undefined;

  if (!(file instanceof File)) {
    return Response.json({ error: 'No audio file was provided.' }, { status: 400 });
  }

  if (process.env.MOCK_LLM === 'true') {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return Response.json({ text: MOCK_TRANSCRIPT, language: languageOverride ?? 'en' });
  }

  try {
    const audio = new Uint8Array(await file.arrayBuffer());
    const modelId = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe';
    const result = await transcribe({
      model: openai.transcription(modelId),
      audio,
      providerOptions: languageOverride ? { openai: { language: languageOverride } } : undefined,
    });
    return Response.json({ text: result.text, language: result.language });
  } catch (error) {
    console.error('Transcription failed:', error);
    return Response.json({ error: 'Could not transcribe that audio — please try again.' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/app/api/transcribe/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/transcribe/route.ts src/app/api/transcribe/route.test.ts
git commit -m "feat: add POST /api/transcribe route for voice input, with a mock mode

Converts an uploaded audio file to text via the ai SDK's transcribe()
and @ai-sdk/openai's transcription model handle, defaulting to
gpt-4o-transcribe (overridable via OPENAI_TRANSCRIBE_MODEL). An
optional language field (ISO-639-1) narrows accuracy; omitted, the
model auto-detects, which fits code-mixed Tamil/English/Hindi/Telugu
speech better than forcing one language. MOCK_LLM=true returns a
canned transcript with no API call."
```

---

### Task 5: Chat page shell, ChatWindow, MessageBubble

**Files:**
- Create: `src/app/chat/page.tsx`
- Create: `src/components/chat/ChatWindow.tsx`
- Create: `src/components/chat/MessageBubble.tsx`
- Create: `src/components/chat/planPart.ts`

**Interfaces:**
- Consumes: `POST /api/chat` (Task 3).
- Produces: `getPlanOutput(part): PlanToolOutput | null` (`planPart.ts`), consumed by Task 6's `JourneyPlanCard`.

No `bun test` coverage in this task — per the spec's Testing section, component-level testing for this UI stays manual (via the `run` skill, Task 9) given there's no established component-testing framework in this repo and no OpenAI credits to exercise the real path. This task's own correctness gate is `bun run lint` and `bunx tsc --noEmit` passing cleanly, plus the manual walkthrough in Task 9.

- [ ] **Step 1: Write the tool-result extraction helper**

Create `src/components/chat/planPart.ts`:

```ts
import type { UIMessage } from 'ai';
import type { JourneyPlanResult } from '../../engine/types';
import type { LastSafeDepartureResult } from '../../engine/lastSafeDeparture';

export interface PlanToolOutput {
  plan: JourneyPlanResult | LastSafeDepartureResult | null;
  narration: string;
}

type MessagePart = UIMessage['parts'][number];

/**
 * Reads a plan_journey/find_last_safe_departure tool result out of a
 * streamed UI message part, if this part is one and its result has
 * arrived. Returns null for every other part (text, other tools, a
 * tool call still in progress).
 */
export function getPlanOutput(part: MessagePart): PlanToolOutput | null {
  if (part.type !== 'tool-plan_journey' && part.type !== 'tool-find_last_safe_departure') return null;
  if (!('state' in part) || part.state !== 'output-available') return null;
  if (!('output' in part) || part.output == null) return null;
  return part.output as PlanToolOutput;
}
```

- [ ] **Step 2: Build MessageBubble**

Create `src/components/chat/MessageBubble.tsx`:

```tsx
import type { UIMessage } from 'ai';
import { getPlanOutput } from './planPart';
import { JourneyPlanCard } from './JourneyPlanCard';

export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 ${
          isUser ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
        }`}
      >
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <p key={index} className="whitespace-pre-wrap text-sm">
                {part.text}
              </p>
            );
          }

          const planOutput = getPlanOutput(part);
          if (planOutput) {
            const { plan, narration } = planOutput;
            return (
              <div key={index} className="flex flex-col gap-2">
                <p className="whitespace-pre-wrap text-sm">{narration}</p>
                {plan && plan.found && <JourneyPlanCard plan={plan} />}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
```

(This imports `JourneyPlanCard` from Task 6 before that task exists — that's fine, TypeScript/Next.js resolves it at build/typecheck time, and Task 6 creates the file in the very next task. Do not stub it out; Task 6 is next.)

- [ ] **Step 3: Build ChatWindow**

Create `src/components/chat/ChatWindow.tsx`:

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

const STORAGE_KEY = 'vazhikaati-chat-history';

function loadStoredMessages(): UIMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function ChatWindow() {
  const [initialMessages] = useState<UIMessage[]>(loadStoredMessages);
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    messages: initialMessages,
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500">
            Ask about a journey — e.g. &quot;How do I get from Ooty to Srivilliputhur tonight?&quot;
          </p>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {status === 'submitted' && <p className="text-sm text-zinc-500">Thinking…</p>}
        {error && <p className="text-sm text-red-600">Something went wrong: {error.message}</p>}
        <div ref={bottomRef} />
      </div>
      <ChatInput
        disabled={status === 'submitted' || status === 'streaming'}
        onSend={(text) => sendMessage({ text })}
      />
    </div>
  );
}
```

- [ ] **Step 4: Build the page shell**

Create `src/app/chat/page.tsx`:

```tsx
import { ChatWindow } from '../../components/chat/ChatWindow';

export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col h-full max-w-2xl w-full mx-auto">
      <header className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">VazhiKaatti</h1>
        <p className="text-xs text-zinc-500">Ask about a bus journey, in Tamil, Hindi, Telugu, or English.</p>
      </header>
      <ChatWindow />
    </div>
  );
}
```

`ChatInput` (imported by `ChatWindow`) doesn't exist until Task 7 — same as `JourneyPlanCard`, this is expected; the type/build check for this task's own gate is scoped to what's reasonable to verify before those files exist (see Step 5).

- [ ] **Step 5: Verify what can be verified now**

`ChatWindow` imports `ChatInput` (Task 7) and `MessageBubble` imports `JourneyPlanCard` (Task 6), neither of which exist yet, so a full `bunx tsc --noEmit`/`bun run lint`/`bun run build` will fail on missing modules until those tasks land — that's expected and not a defect in this task. Confirm instead that `planPart.ts` alone typechecks cleanly:

Run: `bunx tsc --noEmit src/components/chat/planPart.ts`
Expected: no errors originating from `planPart.ts` itself (errors about missing `./JourneyPlanCard` or `./ChatInput` from other files are expected at this point and are resolved by Tasks 6-7).

- [ ] **Step 6: Commit**

```bash
git add src/app/chat/page.tsx src/components/chat/ChatWindow.tsx src/components/chat/MessageBubble.tsx src/components/chat/planPart.ts
git commit -m "feat: add the /chat page shell, ChatWindow, and MessageBubble

ChatWindow wires useChat (new @ai-sdk/react dependency) to POST
/api/chat via DefaultChatTransport, persists the message list to
localStorage (loaded on mount, saved on every change — per the design
spec, no server-side chat persistence), and auto-scrolls. MessageBubble
renders text parts as plain bubbles and reads plan tool-result parts
via the new getPlanOutput() helper for JourneyPlanCard (Task 6) to
render. ChatInput (Task 7) and JourneyPlanCard (Task 6) are imported
here but land in the next two tasks - expected, not a build break to
fix within this task."
```

---

### Task 6: JourneyPlanCard

**Files:**
- Create: `src/components/chat/JourneyPlanCard.tsx`

**Interfaces:**
- Consumes: `JourneyPlanResult`/`LastSafeDepartureResult` (Tasks 1-2's enriched `JourneyLeg`, via `src/engine/types.ts` and `src/engine/lastSafeDeparture.ts`).

- [ ] **Step 1: Build the component**

Create `src/components/chat/JourneyPlanCard.tsx`:

```tsx
import type { JourneyPlanResult } from '../../engine/types';
import type { LastSafeDepartureResult } from '../../engine/lastSafeDeparture';
import type { ConfidenceBand } from '../../engine/types';

const BAND_STYLES: Record<ConfidenceBand, string> = {
  safe: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  tight: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  risky: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  broken: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function ConfidenceBadge({ band }: { band: ConfidenceBand }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BAND_STYLES[band]}`}>{band}</span>;
}

export function JourneyPlanCard({ plan }: { plan: JourneyPlanResult | LastSafeDepartureResult }) {
  if (!plan.found) return null;

  const breakExplanation = 'breakExplanation' in plan ? plan.breakExplanation : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <ol className="flex flex-col gap-2">
        {plan.legs.map((leg, index) => (
          <li key={`${leg.tripId}-${index}`} className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">
                {leg.departureLocal} {leg.fromStopName} → {leg.arrivalLocal} {leg.toStopName}
              </div>
              <div className="text-xs text-zinc-500">{leg.tripId}</div>
            </div>
            <ConfidenceBadge band={leg.confidence} />
          </li>
        ))}
      </ol>
      {plan.overallConfidence && (
        <div className="mt-2 flex items-center gap-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-700">
          <span>Overall:</span>
          <ConfidenceBadge band={plan.overallConfidence} />
        </div>
      )}
      {breakExplanation && (
        <p className="mt-2 rounded-lg bg-orange-50 p-2 text-xs text-orange-800 dark:bg-orange-950 dark:text-orange-200">
          {breakExplanation}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the chat module resolves**

Run: `bunx tsc --noEmit`
Expected: the only remaining errors, if any, reference `./ChatInput` (Task 7) — nothing from `JourneyPlanCard.tsx`, `MessageBubble.tsx`, or `planPart.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/JourneyPlanCard.tsx
git commit -m "feat: add JourneyPlanCard for structured journey-plan display

Leg-by-leg timeline (local time, stop name, confidence badge) plus an
overall-confidence badge and the last-safe-departure break explanation
when present. Reads directly off the enriched JourneyLeg fields from
Tasks 1-2 - no client-side time/ID formatting."
```

---

### Task 7: ChatInput, MicButton, LanguagePicker

**Files:**
- Create: `src/components/chat/ChatInput.tsx`
- Create: `src/components/chat/MicButton.tsx`
- Create: `src/components/chat/LanguagePicker.tsx`

**Interfaces:**
- Consumes: `POST /api/transcribe` (Task 4).
- Produces: `ChatInput`'s `onSend: (text: string) => void` prop, already consumed by Task 5's `ChatWindow`.

- [ ] **Step 1: Build LanguagePicker**

Create `src/components/chat/LanguagePicker.tsx`:

```tsx
const LANGUAGES = [
  { code: '', label: 'Auto' },
  { code: 'ta', label: 'Tamil' },
  { code: 'hi', label: 'Hindi' },
  { code: 'te', label: 'Telugu' },
  { code: 'en', label: 'English' },
] as const;

export function LanguagePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      aria-label="Spoken language for voice input"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Build MicButton**

Create `src/components/chat/MicButton.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';

export function MicButton({
  language,
  onTranscribed,
}: {
  language: string;
  onTranscribed: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', blob, 'clip.webm');
          if (language) formData.append('language', language);

          const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? 'Transcription failed');
          onTranscribed(body.text);
        } catch {
          setErrorMessage("Couldn't hear that — try again.");
        } finally {
          setBusy(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setErrorMessage('Microphone access was denied or unavailable.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={busy}
        aria-pressed={recording}
        aria-label={recording ? 'Stop recording' : 'Start voice input'}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
          recording ? 'bg-red-600 animate-pulse' : 'bg-zinc-700 dark:bg-zinc-600'
        } disabled:opacity-50`}
      >
        {busy ? '…' : '🎤'}
      </button>
      {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Build ChatInput**

Create `src/components/chat/ChatInput.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { MicButton } from './MicButton';
import { LanguagePicker } from './LanguagePicker';

export function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800"
    >
      <MicButton language={language} onTranscribed={(transcribed) => setText(transcribed)} />
      <LanguagePicker value={language} onChange={setLanguage} />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about a journey…"
        className="flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Typecheck and lint the whole app**

Run: `bunx tsc --noEmit`
Expected: no errors (every file the chat feature touches now exists).

Run: `bun run lint`
Expected: exit 0.

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS, all files (this task adds no new `bun test` coverage, so this just confirms nothing broke).

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ChatInput.tsx src/components/chat/MicButton.tsx src/components/chat/LanguagePicker.tsx
git commit -m "feat: add voice input (MicButton), language override picker, and ChatInput

MicButton uses MediaRecorder to record on tap, POSTs the clip to
/api/transcribe on stop, and fills the text box with the transcript
for the user to review/edit before sending - not auto-sent, so a
misheard word can be corrected. LanguagePicker overrides transcription
language (Tamil/Hindi/Telugu/English); left on Auto, the transcription
model auto-detects, which suits code-mixed speech better than forcing
one language."
```

---

### Task 8: Visual design pass

**Files:**
- Modify: `src/app/chat/page.tsx`, `src/components/chat/*.tsx` (styling only — no logic changes)
- Modify: `src/app/globals.css` (if the design calls for new theme tokens)

**Interfaces:** None new — this task only restyles what Tasks 5-7 built.

- [ ] **Step 1: Load the frontend-design skill and apply it**

Use the `frontend-design` skill (per the spec's explicit routing) to give this chat UI an intentional visual pass: typography, spacing, the confidence-badge palette (the placeholder green/yellow/orange/red from Task 6 is functional but not vetted for contrast/distinctiveness), mobile-first layout (most users will be on a phone at a bus stand, per the product framing), and light/dark mode (the scaffold's `globals.css` already has a dark-mode media query — extend that pattern, don't replace it with something inconsistent). Do not change any component's props, data flow, or logic — this task is `className`/CSS only, plus whatever new design tokens `globals.css` needs.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS — a pure styling pass should not touch anything `bun test` covers, but confirm nothing broke.

Run: `bun run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/page.tsx src/components/chat/ src/app/globals.css
git commit -m "style: visual design pass on the chat UI

Applied via the frontend-design skill: typography, spacing, a vetted
confidence-badge palette, mobile-first layout, and light/dark mode
consistent with the existing globals.css tokens. No logic or data-flow
changes."
```

---

### Task 9: Manual end-to-end verification (mock mode)

**Files:**
- Modify: `src/ingest/runIngest.ts` (small ordering/robustness fix, needed for this task to work without the real CSV file present)

**Interfaces:** None new — this task verifies Tasks 1-8 together.

- [ ] **Step 1: Fix runIngest.ts so the demo corridor loads even without the real CSV**

`bun run ingest` currently ingests the real SETC CSV *before* the demo corridor, and the CSV path only exists if someone has manually downloaded `SETCbustimings_1_0.csv` (gitignored, per `README.md`) — without it, `ingestSetcCsv` throws before `ingestDemoCorridor` ever runs, so a dev database with no CSV downloaded has no demo data to verify against either. Fix `src/ingest/runIngest.ts`'s `main()` function to ingest the demo corridor first (it has no file dependency) and continue past a missing-CSV error instead of aborting:

```ts
import { db } from '../db/client';
import { ingestSetcCsv } from './setcCsv';
import { ingestDemoCorridor } from './demoCorridor';

async function main() {
  console.log('Ingesting synthetic demo corridor...');
  await ingestDemoCorridor(db);

  const csvPath = process.argv[2] ?? 'SETCbustimings_1_0.csv';
  try {
    console.log(`Ingesting SETC CSV from ${csvPath}...`);
    const result = await ingestSetcCsv(db, csvPath);
    console.log(`  ${result.rowsProcessed} rows imported, ${result.rowsRejected} rejected.`);
    for (const r of result.rejections) {
      console.log(`    row ${r.row}: ${r.reason}`);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.log(`  ${csvPath} not found — skipping real-data ingestion (demo corridor is still loaded).`);
    } else {
      throw error;
    }
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Run: `bun run ingest` against your dev database (`DATABASE_URL` in `.env`).
Expected: `Ingesting synthetic demo corridor...` then either the CSV importing normally (if you have the file) or the new "not found — skipping" message — either way, `Done.` at the end, and no thrown error.

Commit this fix on its own before moving on:

```bash
git add src/ingest/runIngest.ts
git commit -m "fix: ingest the demo corridor even when the real SETC CSV is absent

runIngest.ts ingested the real CSV first and the demo corridor second,
so a dev database with no CSV downloaded (it's gitignored, per
README.md) never got demo data either - main() aborted on the missing
file before reaching ingestDemoCorridor(). Reordered and wrapped the
CSV step in a specific ENOENT catch so a missing file is reported and
skipped, not fatal."
```

- [ ] **Step 2: Launch the app in mock mode and drive it**

Use the `run` skill to launch the dev server with `MOCK_LLM=true` set, and drive the `/chat` page: type "How do I get from Ooty to Srivilliputhur?" and confirm a `JourneyPlanCard` renders with the real demo-corridor chain (`OOTY_MTP_A`, `MTP_TPR_A`, `TPR_MDU_LAST`, `MDU_SVP_LAST`) and human-readable stop names/times (not raw IDs or epoch numbers). Reload the page and confirm the conversation persists (localStorage). Type an unrelated question and confirm the canned "MOCK_LLM is on..." reply appears instead of a crash.

Note the `run` skill's environment likely cannot exercise a real microphone — visually confirm the mic button, language picker, and their layout render correctly, but treat the actual record→transcribe round trip as **not verifiable in this environment**; it needs a real browser with microphone access and (for the real, non-mock path) an OpenAI key, which is explicitly out of reach right now (no API credits). Say so plainly in your report rather than claiming it works.

- [ ] **Step 3: Report results**

Summarize what was verified (chat flow, plan card, persistence, mock-mode fallback reply) and what could not be (live microphone capture, real OpenAI transcription/chat calls) — this is the honest state of the feature until real API credits and a real browser session are available to close that gap.
