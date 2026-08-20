# VazhiKaatti (வழிகாட்டி)

**"Which bus gets you there — and will you make it?"**

VazhiKaatti is a chat-based journey planner for intercity government buses
in Tamil Nadu. Type — or speak — something like *"I need to get from Ooty
to Srivilliputhur tonight"* in Tamil, Hindi, Telugu, or English, and it
works out which buses to take, in what order, whether the connections
actually hold together, and gives a plain warning if one doesn't.

Live at `/` (landing + chat hero) and `/chat` (the conversation itself).

## The problem

Which government bus goes where, and when, isn't written down anywhere a
computer can read. It exists on paper, on notice boards, in conductors'
memory. A single-route timetable has nothing to say when no one bus goes
all the way — you're left guessing where to change, and if you get it
wrong, you can end up stranded at an unfamiliar stop overnight with no
warning beforehand. Most transit tooling that does exist assumes you're
planning your trip in English, when most riders aren't.

VazhiKaatti is one ledger of every stop and timing in a form a computer can
actually search, an engine that works out multi-leg journeys across it
(transfers included, up to three route options), a checker that flags a
risky connection instead of softening it, and a chat interface that
answers in whatever language you asked in.

**Explicitly out of scope, for now:** seat booking with payment (needs
seat-inventory and payment infrastructure that doesn't exist yet), and
live in-journey tracking with push notifications (needs a real-time
vehicle-position feed that doesn't exist and isn't confirmed obtainable).
Both are part of the long-term vision, deliberately deferred to their own
design cycles rather than half-built here.

## What's real, and what's mocked — disclosed plainly

This matters enough to say up front, not bury in a data-sources appendix:

| | |
|---|---|
| **Real** | A published SETC timetable CSV from Tamil Nadu's open-data portal (real routes and timings — though the source data itself only lists an origin/destination pair per trip, no intermediate stops), and every stop's coordinates. |
| **Estimated** | Travel times on the five mock GTFS corridors, computed from OSRM's real road-routing API against the actual road geometry (ghats included), scaled by a bus-realism factor — not a flat distance/speed guess. |
| **Synthetic** | The mock corridors' specific schedules, trip IDs, and service frequencies. Stop names/coordinates are real bus-stand locations and the corridor topology (which towns a route actually passes through, in what order) was confirmed against real travel experience — but there is no real TNSTC/SETC timetable behind these five corridors. |

The mock GTFS feed exists because the real SETC data only has origin and
destination per trip, with no intermediate stops — it can't demonstrate a
genuine multi-leg journey on its own. The point of building a full [GTFS
static-feed parser](https://developers.google.com/transit/gtfs/) instead
of more one-off CSV logic: if Tamil Nadu's transport department ever
publishes a real GTFS feed, it ingests through the exact same code path,
unchanged. The mock data is a stand-in for that feed, not the product's
ceiling.

## Architecture

```
src/db/       Postgres schema (Drizzle ORM), GTFS-shaped from the start —
              stops, routes, trips, stop times, calendars, transfers,
              trip reliability.
src/ingest/   A real GTFS static-feed parser (agency/stops/routes/trips/
              stop_times/calendar/transfers.txt), a mock-GTFS generator
              that routes real road geometry through OSRM, and the SETC
              CSV importer.
src/engine/   An in-memory earliest-arrival connection-scan search over
              the ledger, a same-trip-vs-transfer-aware leg builder, and
              a "Connection Confidence" scorer that never fabricates a
              reliability number — no data means "insufficient data," not
              a guess.
src/llm/      Two AI SDK tools (plan_journey, find_last_safe_departure)
              wrapping the engine, and a tool-loop agent whose system
              prompt only states facts a tool actually returned.
src/app/      The landing page, the /chat page, and the streaming
              /api/chat and /api/transcribe routes.
src/components/chat/  The chat UI: composer, message bubbles, the
              journey-plan card, voice input, the problems/solutions
              section.
```

All times are anchored to IST (Asia/Kolkata) at the source, not UTC. Every
leg's confidence is a four-band signal (safe/tight/risky/broken) with a
pip meter, so it survives a dim phone screen and doesn't rely on colour
alone.

**Tech stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 ·
Drizzle ORM / Postgres · the Vercel AI SDK (`ai`, `@ai-sdk/react`,
`@ai-sdk/openai`) · Bun (runtime, package manager, test runner).

## Getting started

**Prerequisites:** [Bun](https://bun.sh), a local Postgres instance.

```bash
bun install
cp .env.example .env   # then fill in DATABASE_URL / DATABASE_URL_TEST
```

Download the real SETC timetable CSV from Tamil Nadu's open-data portal —
**[tn.data.gov.in](https://tn.data.gov.in/)**, search "SETC bus timings"
(or the current equivalent SETC/TNSTC timetable dataset) — into the
project root. It's not committed; if its filename or shape changes
upstream, check it against `src/ingest/setcCsv.ts` before re-running the
importer.

Seed the database, then run the app:

```bash
bun run ingest        # real SETC CSV + a small hand-authored demo corridor
bun run ingest:gtfs   # generates and ingests the mock GTFS network
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) and ask about a
journey — e.g. Ooty to Srivilliputhur.

**Running without an OpenAI key:** set `MOCK_LLM=true` in `.env`. Both
`/api/chat` and `/api/transcribe` swap in scripted responses — `/api/chat`'s
mock still calls the real `plan_journey` tool against real seeded data for
a recognized query, so the whole app is exercisable end to end with no API
key and no cost.

## Testing

```bash
bun test           # needs DATABASE_URL_TEST — see .env.example
bun run lint
bun run typecheck
bun run build
```

## How this was built

Built with AI pair-programming as part of the actual workflow, not
as a bolt-on afterthought — across the whole lifecycle:

- **Researching:** working out what data actually exists for Tamil Nadu
  intercity buses (the real SETC open-data CSV, its origin/destination-only
  shape, and what that shape does and doesn't make possible), and what
  standard to build against (GTFS) so that a future real feed from the
  transport department drops in without a rewrite.
- **Prototyping:** the first end-to-end path from a plain-language question
  to a scored, multi-leg journey plan, including the earliest-arrival
  connection-scan search and the confidence scorer that refuses to invent
  a reliability number it doesn't have data for.
- **Developing:** the GTFS ingestion pipeline, the mock-corridor generator
  that routes real road geometry through OSRM rather than guessing travel
  times, the LLM tool layer, and the chat UI — including several real bugs
  found and root-caused this way: a stop-name/coordinate data collision
  between two independent ingesters, a same-trip-vs-transfer miscount in
  the search engine, and a corridor-geography correction driven by the
  project owner's own real travel experience with these routes.
- **Design iteration:** multiple passes on the chat UI itself — a
  two-column layout, then a forced-dark OpenAI/Vercel-styled landing page
  with its own hero and problems/solutions section, each verified visually
  before being kept.

Every step stayed under human review and direction throughout; nothing
here shipped by an agent working unsupervised.

## License

[GNU AGPL v3.0](LICENSE).
