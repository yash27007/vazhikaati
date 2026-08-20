# VazhiKaatti (வழிகாட்டி)

**"Which bus gets you there — and will you make it?"**

VazhiKaatti is a chat-based journey planner for intercity government buses
in Tamil Nadu. Type — or speak — something like *"I need to get from Ooty
to Srivilliputhur tonight"* in Tamil, Hindi, Telugu, or English, and it
works out which buses to take, in what order, whether the connections
actually hold together, and gives a plain warning if one doesn't.

Live at `/` (landing + chat hero) and `/chat` (the conversation itself).

## Why this exists

I spent five hours at Tirupur bus stand, from ten at night until three in
the morning, waiting for a bus that was never coming.

I was heading back from college. I'd reached Madurai, and I asked — that's
what you do, there's nothing else to ask. The conductor told me to go to
Tirupur, buses would be there. So I went to Tirupur. There were no buses.

I asked again at the stand. The staff there told me something different:
those buses wouldn't be there, I'd have to go to the other bus stand [ New bus stand]
across town, because the services I wanted don't come into the one I was
standing in. Two people, both working in transport, both confident, and
between them I still didn't have an answer I could act on at eleven at
night in a town I don't live in.

So I sat down and waited for morning.

Nobody was lying to me. They just didn't know. That's the part that stayed
with me — the information doesn't exist in a form anyone can be sure of,
not even the people who work there.

### The route I actually take

Home is Ooty. College is in Srivilliputhur.

At night there *is* a direct service: an SETC bus runs Ooty to
Rajapalayam, and I get down at Srivilliputhur on the way. That bus is
genuinely useful and I only know about it because I found out by asking
around. No site I've used told me it existed, and none of them know that
Srivilliputhur is a stop on the way to somewhere else.

In the morning, that service isn't running. So a morning trip becomes a
chain:

```
Ooty → Mettupalayam → Tirupur -> Kovilvazhi → Madurai → Srivilliputhur
```

Four buses, no timetable I can look at, and the same question at every
change: is the next one still running, and which stand does it leave from?

Every booking site I've tried answers the whole thing with *no buses
found* — which isn't true in either direction. In the morning there are
buses, just not one bus. At night there's a direct one, and the site
doesn't know it stops where I need. The network works. The knowledge of
the network is what's broken.

## This isn't one student's bad luck

Once I started paying attention, I realised the thing that stranded me
wasn't rare — it's the normal condition of travelling by government bus
anywhere outside a big city.

**Locals don't know either.** People assume the problem is that outsiders
are unfamiliar. It isn't. The conductor didn't know. The stand staff
didn't know. Everyone is working from partial, second-hand information
about which service runs when, and from which of a town's several bus
stands. Nobody holds the whole picture, so nobody can give you a reliable
answer.

**It gets worse the further you are from a city.** In a metro you can fall
back on an app, or a train, or an auto you can afford. In tier-2 and
tier-3 towns the government bus often *is* the transport — and it's
precisely there that the timetable is a notice board, or a person's
memory, or nothing. Most people in Tamil Nadu don't live in Chennai or
Coimbatore. The places with the least information are the places that
depend on buses the most.

**And if you're new, you have nothing.** Someone arriving in Tamil Nadu,
or just travelling to a district they've never been to, has no network of
people to ask. They can't do what I did — get it wrong once, ask around,
and slowly build a mental map of which bus goes where. They're standing at
a stand with a phone that can't answer the question.

The same shape of failure shows up across states: routes where no direct
service exists and no one tells you, single daily buses that vanish
without notice, students walking kilometres because a timing doesn't work.
The people who pay for it are consistent — students commuting to colleges
in other districts, daily-wage and migrant workers, patients travelling to
district hospitals, elderly passengers.

Private bus travel solved this over a decade ago, because someone had a
commercial reason to write the data down. Public transport carries more
people, and still runs on word of mouth.

## The problem, stated plainly

Which government bus goes where, and when, isn't written down anywhere a
computer can read. It exists on paper, on notice boards, in conductors'
memory — and, as I found out, not reliably even there. A single-route
timetable has nothing to say when no one bus goes all the way. It also has
nothing to say when a direct bus *does* exist but passes through your stop
on its way somewhere else. You're left guessing where to change, which
stand to change at, and whether the next service is still running — and if
you guess wrong, you find out at midnight.

VazhiKaatti is one ledger of every stop and timing in a form a computer can
actually search, an engine that works out multi-leg journeys across it
(transfers included, up to three route options), a checker that flags a
risky connection instead of softening it, and a chat interface that
answers in whatever language you asked in.

Two things follow from putting Tamil Nadu's bus network into a standard,
queryable shape, and they're the point of the whole project:

**You can ask from anywhere, about anywhere.** Not just routes you already
know to look for. Stand in a town you've never been to, say where you are
and where you need to go, and get an answer that doesn't depend on finding
the right person to ask.

**A bus that passes through counts.** Because the ledger holds every stop
on every trip, not just origin and destination, a service going somewhere
else entirely can still be your ride — which is exactly the fact about my
own route that no website has ever known.

The connection check is the part I care most about. It doesn't just tell
you a journey exists — it tells you how much slack you have at each
change, and says so bluntly when there isn't enough. The warning I never
got is the feature.

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
genuine multi-leg journey on its own. It also can't express the thing that
matters most on my own route: that a bus to Rajapalayam is a bus to
Srivilliputhur, if you know it stops there. The point of building a full
[GTFS static-feed parser](https://developers.google.com/transit/gtfs/)
instead of more one-off CSV logic: if Tamil Nadu's transport department
ever publishes a real GTFS feed, it ingests through the exact same code
path, unchanged. The mock data is a stand-in for that feed, not the
product's ceiling.

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

Built with codex-cli, and chatgpt for planning and researching:

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

[GNU AGPL v3.0](LICENSE)