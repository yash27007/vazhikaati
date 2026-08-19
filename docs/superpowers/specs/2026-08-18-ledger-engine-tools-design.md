# VazhiKaatti — Ledger, Journey Engine & LLM Tool Layer

**Status:** Approved for planning
**Date:** 2026-08-18
**Scope:** Sub-project A of the VazhiKaatti build (see `CLAUDE.md` for full product spec). Sub-project B (chat web UI) and booking (seat holds/payments/reconciler) are explicitly deferred to later specs.

## 1. What this delivers

A backend-only slice that proves the core claim of the product: the missing data layer, made queryable, with a journey engine on top that can answer "how do I get from A to B, and will I actually make it" — including through connections no single bus covers. An OpenAI tool-calling layer sits on top so the engine is consumable by natural language, even though it can't be exercised live yet (no API key available during this build).

No UI. No booking. No live GPS. No passenger observations. Verified entirely by `bun test`.

## 2. Out of scope (explicitly deferred)

- Seat holds, payment intents, mock gateway, reconciler, entitlement trigger (§7.4 of CLAUDE.md) — a later spec once this layer is proven.
- `journey_subscriptions` / `notifications_sent` (§7.5) — depends on booking existing first.
- Chat web UI, WhatsApp-style surface, voice input, multi-language UI chrome — sub-project B.
- Live GPS replay, `vehicle_positions` writes, passenger-sourced `trip_observations` writes — the tables exist (so the reliability cold-start path is real, not stubbed), but nothing populates them yet.
- `get_live_trip_status` and `check_seat_availability` tools — not implemented; their backing data doesn't exist yet.

## 3. Environments & persistence

**Neon (Postgres, free tier) + Drizzle ORM**, matching the literal Postgres DDL already written in `CLAUDE.md` §7 (native arrays, `JSONB`, `CHECK` constraints, and — later — `plpgsql` triggers for booking). This is the one persistence layer for the project's full lifecycle, not just this phase: booking will extend the same schema, not replace it.

Two environments, one schema, different connection strings via `DATABASE_URL`:

- **Dev/test:** the local Postgres 16 server already running on this machine (`localhost:5432`) — zero network latency, zero cost, used for `bun test` runs against a disposable `vazhikaati_test` database, reset per run.
- **Production:** Neon free tier, provisioned through Vercel's Postgres integration, used only by the deployed app.

Drizzle schema/migration code is identical across both — only the connection string differs. No SQLite, no bundled files, no in-memory fallback.

## 4. Schema (this phase)

Drizzle tables covering CLAUDE.md §7.1 (ledger) and §7.2 (reality), created via `drizzle-kit` migrations:

- `agencies`, `stops`, `routes`, `calendars`, `calendar_exceptions`, `trips`, `stop_times`, `transfers`
- `vehicle_positions`, `trip_observations`, `trip_reliability`

`journey_plans` / `journey_legs` (§7.3) are **not** created this phase. Journey search is computed on demand and returned as a plain structured object — nothing about a search is written back to the database. These tables get added when booking needs a `plan_id` to reference; adding them later is a clean additive migration, not a rework.

Booking (§7.4) and notification (§7.5) tables are not created this phase, for the same reason: nothing consumes them yet, and adding them is additive.

## 5. Seed data

Two ingestion scripts, run once against the target `DATABASE_URL`:

- **`src/ingest/setc-csv.ts`** — parses `SETCbustimings_1_0.csv` (549 rows) into tier-1 (`data_tier = 1`) `trips`/`stop_times`. Each row is a direct point-to-point service: one `stops` row per named town (single generic stand — the CSV has no stand-level granularity), one `trips` row, two `stop_times` rows (origin/destination). `arrival_minutes` is derived from `Route Length ÷ 45 km/h` — one flat, documented assumption (a plausible state-bus average accounting for highway sections and scheduled halts), applied uniformly, not type-differentiated by ULTRA vs A/C. Rows with unparseable fields are rejected and logged, never silently dropped. Timings in the CSV are `HH.MM` (hour-dot-minute, not decimal hours — confirmed by inspecting values like `.16`, `.35`, `.50`, `.01` that only make sense as literal minutes).
- **`src/ingest/demo-corridor.ts`** — hand-authored tier-3 (`data_tier = 3`) synthetic corridor reproducing the spec's own worked example: Ooty → Mettupalayam → Tirupur → Madurai → Srivilliputhur, with real multi-stand modeling and `transfers` rows at Mettupalayam and Tirupur (the towns where a connection is actually made), and explicit `safe_overnight` / `is_lit_at_night` values on the Tirupur stand so the stranding scenario (last Tirupur→Madurai departs 21:15; leaving Ooty after 17:20 strands you until 04:30) is a computed result of the engine, not a hardcoded string.

Both scripts are idempotent (safe to re-run against a fresh database) and are the "Codex-generated ingestion adapter" the product spec calls for in §8.1 — each targets the one fixed schema above.

## 6. Journey engine

Plain TypeScript modules under `src/engine/`, each taking a Drizzle client and query parameters, doing a small number of targeted queries to pull the relevant candidate subgraph (trips/stop_times/transfers within the relevant stops and time window) into memory, then running the search in JS — the dataset (~550 real rows + one corridor) is small enough that this is simpler and faster than pushing full graph traversal into SQL.

- **`search.ts`** — multi-leg journey search honoring `calendars`/`calendar_exceptions` (including day-of-week and post-midnight rollover per GTFS convention — `stop_times` store minutes-past-service-day-start, never wall-clock `TIME`), `transfers.min_transfer_minutes`, and a `max_legs` cap (default 4, per the tool schema in CLAUDE.md §8.2).
- **`confidence.ts`** — Connection Confidence scoring per the CLAUDE.md §4.2 bands (Safe/Tight/Risky/Broken), computed from `buffer_score`, `fallback_score`, `freshness_score`/tier, and `stranding_penalty`. `reliability_score` is a distinct, explicit "insufficient data" state whenever a leg's `trip_reliability` row is missing or has `sample_size = 0` — never a fabricated or defaulted number. The result's `confidence_reasons` array says so explicitly (e.g. `"no reliability history yet"`) rather than implying an observed on-time rate that doesn't exist.
- **`lastSafeDeparture.ts`** — backward search variant of `search.ts`: given an `arrive_by` constraint, walks chains backward to find the latest viable departure, and explicitly reports why later options fail (mirroring the CLAUDE.md §4.1 example output).

Each module exports plain functions returning plain structured data (no framework coupling) — directly unit-testable, and directly callable by the LLM tools below.

## 7. LLM tool layer

`src/llm/` — built using the AI SDK's `ToolLoopAgent` (per the `ai-sdk` skill's own guidance: use the built-in agent abstraction, never a hand-rolled tool loop) with the `@ai-sdk/openai` provider (already installed).

- **`tools.ts`** — exactly two tools, both Zod-typed, both calling straight into the engine modules from §6 (in-process function calls — no internal HTTP hop, since everything runs server-side):
  - `plan_journey` — wraps `search.ts`
  - `find_last_safe_departure` — wraps `lastSafeDeparture.ts`

  Each tool returns a structured result — the engine's plain object (legs, times, confidence bands, reasons) — alongside a short natural-language narration string. The model narrates from real structured data; nothing about the schedule is left for the model to compose from scratch. This same structure is what sub-project B's chat UI will render as confidence-band cards later, without needing to re-parse prose.

- **`agent.ts`** — agent configuration and the system prompt. Guardrails, stated explicitly in the prompt (per CLAUDE.md §8):
  - The assistant may only report schedule facts returned by a tool call. If no tool returns data, it says so and offers the nearest known alternative — it never estimates a timing.
  - Reply in whatever language or mix the user wrote in (Tamil, English, or code-mixed) — no separate detection/translation step; this is a model-capability assumption, not custom-built.
  - Fails fast and clearly at module load if `OPENAI_API_KEY` is unset, rather than surfacing a confusing error mid-request. This is expected to fail-fast during this build, since no key exists yet — the tools and engine remain fully testable independent of the agent module.

## 8. Error handling

- No viable chain found → engine returns an explicit "no route" result (never throws), which the tool layer surfaces as-is and the model reports plainly.
- Malformed seed rows → ingestion scripts reject and log, never silently drop or crash the run.
- Missing `OPENAI_API_KEY` → fails fast at `agent.ts` load time with a clear message; does not block testing `tools.ts`/`engine/` directly.

## 9. Testing

`bun test` against the local Postgres dev database (a disposable `vazhikaati_test` database, migrated and seeded fresh per run):

- Ingestion correctness (CSV parsing edge cases, HH.MM timing parsing, malformed-row rejection, idempotency)
- Search correctness, anchored on the exact worked Ooty→Srivilliputhur example (21:15 last connection, 17:20 departure cutoff, 04:30 stranding)
- Confidence banding, including the explicit "insufficient data" cold-start path
- Both tool functions (`plan_journey`, `find_last_safe_departure`) called directly as functions, bypassing the model entirely — proving the tool contracts independent of having an API key

The `agent.ts` wiring itself (the actual tool-calling loop against a live OpenAI model) is built to spec but cannot be verified end-to-end until an `OPENAI_API_KEY` is available — this is a known, stated limitation of this phase, not an oversight.

## 10. Follow-on phases (not this spec)

- Booking: seat holds, payment intents, mock gateway, reconciler, entitlement trigger — extends this same schema additively.
- Chat web UI (sub-project B): guest chat, renders the structured tool output as confidence-band cards, book-later CTA.
- Voice input, multi-language UI chrome.
- Live GPS replay populating `vehicle_positions`; passenger-sourced `trip_observations` closing the loop on `trip_reliability`.
