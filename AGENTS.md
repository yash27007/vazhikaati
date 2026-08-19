<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VazhiKaatti — project idea and implementation

## The idea

A place where you type "I need to get from Ooty to Srivilliputhur tonight"
and it tells you which buses to take, in what order, and whether you'll
actually make it.

Someone opens the site on their phone. There's a chat box. They type in
Tamil, Hindi, Telugu, English, or however they'd talk to a friend — or they
speak it. The reply comes back like a message: take this bus, then this
one, then this one, you'll reach by such-and-such time — and a plain
warning if the connection is risky (e.g. leaving after a certain time
strands you overnight at a stop until the next morning's bus).

Why this is worth building: nobody has written down which government buses
go where and when in a form a computer can read. It exists on paper, on
notice boards, in conductors' heads. This project is that missing
notebook — one organised ledger of every bus, stop, and timing — plus an
engine that reads it and works out journeys where no single bus goes all
the way, plus a chat interface anyone can actually use.

**Explicitly out of scope for what's built so far:** seat booking with
payment (needs seat-inventory/payment infrastructure that doesn't exist
yet), and live in-journey tracking with push notifications (needs a
real-time vehicle-position data source that doesn't exist and isn't
confirmed to be obtainable). Both are real parts of the long-term vision,
deliberately deferred to their own future design cycles.

## What's implemented

**The ledger + engine** (`src/db/`, `src/engine/`, `src/ingest/`): a
Postgres/Drizzle schema for stops, routes, trips, stop times, transfers,
and trip reliability; ingestion of both a real published SETC timetable CSV
and a hand-authored synthetic demo corridor (Ooty → Mettupalayam → Tirupur
→ Madurai → Srivilliputhur) for deterministic testing; an in-memory
earliest-arrival connection-scan search algorithm; a "Connection Confidence"
scorer that never fabricates a reliability number (no data → "insufficient
data," not a guess); a forward multi-leg journey search
(`planJourney`); and a backward "last safe departure" search that
disqualifies chains requiring an unsafe overnight wait at a stop. All times
are anchored to IST (Asia/Kolkata) at the source, not UTC.

**The LLM tool layer** (`src/llm/`): two AI SDK tools —
`plan_journey` and `find_last_safe_departure` — wrapping the engine, plus a
`ToolLoopAgent` with a system prompt that only states schedule facts a tool
actually returned, replies in whatever language the user wrote in, and
never softens a risky connection.

**The chat UI** (`src/app/chat/`, `src/app/api/`, `src/components/chat/`):
a `/chat` page (the app's root `/` redirects here) built on `@ai-sdk/react`'s
`useChat`, streaming through `POST /api/chat`. Journey plans render as a
structured card (leg-by-leg timeline, human-readable stop names/local
times, a four-band confidence badge) alongside the assistant's narration,
not narration alone. Voice input records via the browser's `MediaRecorder`,
uploads to `POST /api/transcribe`, and is transcribed via OpenAI's
transcription API with language auto-detection (Tamil/Hindi/Telugu/English,
or an explicit override) — the transcript fills the text box for the user
to review before sending, not auto-sent. Chat history persists in
`localStorage` only; nothing is persisted server-side.

**Running without an OpenAI key:** set `MOCK_LLM=true` (already the default
in this repo's `.env`). Both `/api/chat` and `/api/transcribe` swap in
scripted responses in that mode — `/api/chat`'s mock still calls the real
`plan_journey` tool against real demo-corridor data for a recognized
Ooty/Srivilliputhur-shaped query, so the whole UI is exercisable end to end
with no API key and no cost. `bun run dev`, then open `/chat` (or `/`,
which redirects there) and ask about a journey from Ooty to Srivilliputhur.

**Testing:** `bun test` (needs local Postgres — see `.env.example`),
`bun run lint`, `bunx tsc --noEmit` / `bun run typecheck`, `bun run build`.

