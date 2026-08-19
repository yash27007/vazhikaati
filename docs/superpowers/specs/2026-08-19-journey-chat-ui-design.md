# Journey Chat UI — Design

Branch: `worktree-ledger-engine-tools` (same branch as the backend this builds on — merges
to `main` together with it, per the user's explicit instruction).

Builds on: `docs/superpowers/specs/2026-08-18-ledger-engine-tools-design.md` (the ledger,
engine, and LLM tool layer this UI is a client of). Read that spec first — this one assumes
its vocabulary (`plan_journey`, `find_last_safe_departure`, `ConfidenceBand`, `JourneyLeg`,
the demo corridor) without re-explaining it.

## Product framing

The user's own words, verbatim, for why this exists:

> A place where you type "I need to get from Ooty to Srivilliputhur tonight" and it tells you
> which buses to take, in what order, and whether you'll actually make it.
>
> They open your site on their phone. There's a chat box. They type in Tamil or English,
> however they'd talk to a friend. The reply comes back like a message: take the 3:40 bus to
> Mettupalayam, then this one to Tirupur, then this one to Madurai. You'll reach at 12:05 AM.
> And a warning if it's risky — don't leave after 5:20 PM, you'll get stuck at Tirupur till
> 4:30 in the morning.

The full long-term vision also includes seat booking with resilient payment retry, and live
in-journey tracking with push notifications ("your bus is 20 minutes from Mettupalayam").
**Both are explicitly out of scope for this spec** — confirmed with the user. Booking needs
seat-inventory/payment infrastructure that doesn't exist (the backend plan's Global
Constraints explicitly defer it: "No booking tables this phase... additive later"). Live
tracking needs a real-time vehicle-position data source that doesn't exist yet — the SETC CSV
is a static schedule, not a live feed; whether such a feed is obtainable at all is an
unanswered feasibility question, not a design question, and belongs to its own future
brainstorm.

## Scope

**In scope:** a chat interface where a user types or speaks a journey query in natural
language (Tamil, Hindi, Telugu, English, or code-mixed) and gets back a conversational reply
plus a structured, human-readable journey plan — using the `plan_journey` and
`find_last_safe_departure` tools and the `ToolLoopAgent` already built in Task 11.

**Out of scope:** booking, payment, live tracking, push notifications, user accounts,
persisted (server-side) chat history, multi-conversation history/sidebar, text-to-speech
output, deployment/production hardening (rate limiting, auth) — this is a personal/local tool
for now, matching the backend plan's own deferral of production concerns.

## Decisions log

Each decision below was put to the user explicitly (via `/grilling`); recorded here so a
future reader doesn't have to reconstruct why.

| # | Decision | Chosen |
|---|---|---|
| 1 | Voice transcription | Server-side, OpenAI transcription API (Whisper-family), supporting Tamil/Hindi/Telugu/English |
| 2 | UI scope | Single chat page, one active conversation (no multi-conversation app) |
| 3 | Voice output | Text-out only — no TTS on replies |
| 4 | Language selection | Auto-detect by default, with an optional override picker |
| 5 | Plan display | Narration bubble + structured visual card (leg timeline, confidence badges), not plain text |
| 6 | No-API-credits testing | Build a `MOCK_LLM` dev mode using real demo-corridor data, so the flow is verifiable without live API cost |
| 7 | Chat history | Persisted client-side only, via `localStorage` — no server persistence |
| 8 | Access scope | Personal/local tool for now — no auth/rate-limiting |
| 9 | Timezone | Fix the backend's UTC-vs-IST ambiguity at the source (Section: Backend enrichment), not band-aided in the UI |

## Backend enrichment (prerequisite, done before UI code)

Two small, additive changes to the already-built-and-reviewed engine — their own scoped
task, TDD'd the same way as Tasks 1–11, before any UI code is written.

### IST anchoring

`src/engine/loadConnections.ts`'s `absoluteMinutes()` currently anchors each date to **UTC**
midnight:

```ts
function absoluteMinutes(dateStr: string, minutesPastMidnight: number): number {
  return Date.parse(`${dateStr}T00:00:00Z`) / 60000 + minutesPastMidnight;
}
```

A scheduled "15:40" is therefore stored as 15:40 UTC = 21:10 IST — silently wrong for an
India bus timetable. Fix: anchor to IST midnight instead (`+05:30` offset, i.e.
`Date.parse(\`${dateStr}T00:00:00+05:30\`)`). This is the one place connection times are
converted from wall-clock to absolute minutes, so the fix is localized to this function.

Callers that parse a caller-supplied deadline/window (`Date.parse(input.arriveBy)` in
`src/engine/search.ts` and `src/engine/lastSafeDeparture.ts`, and `dateRangeFrom` in
`src/engine/shared.ts`) need the same reinterpretation: a bare ISO string with no offset
(e.g. `'2026-08-17T08:00:00'`) should be parsed as IST, not as the JS-default local/UTC
behavior. Existing tests currently pass `Z`-suffixed (UTC) datetimes — these get updated to
the corrected, unambiguous IST-offset form (`+05:30`) as part of this fix, with their
expected leg times updated to match. This is a self-consistent internal change (the engine
only ever compared its own numbers to each other) that becomes externally correct once fixed
— low-to-medium risk, confirmed with the user given the stakes of a bus-timing app getting
times wrong.

### Human-readable leg output

`JourneyLeg` (`src/engine/types.ts`) currently exposes only `fromStopId`/`toStopId` (internal
IDs like `OOTY_STAND`) and `departureAbsMin`/`arrivalAbsMin` (raw epoch-minutes) — nothing a
UI can show a person directly. Add, resolved inside `buildLegsWithConfidence`
(`src/engine/search.ts`, which already queries the DB and has access to `stops.name`):

```ts
export interface JourneyLeg {
  // ...existing fields unchanged...
  fromStopName: string;   // e.g. "Ooty Bus Stand"
  toStopName: string;     // e.g. "Mettupalayam Bus Stand"
  departureLocal: string; // IST wall-clock, e.g. "15:40"
  arrivalLocal: string;   // IST wall-clock, e.g. "17:10"
}
```

Purely additive — existing fields and existing call sites are untouched; only new fields are
added to the object and the type. `narratePlan`/`narrateLastSafeDeparture`
(`src/llm/tools.ts`) get updated to use the new fields in their narration strings instead of
raw IDs/epoch-minutes, so the agent's own text output improves too, not just the UI's
structured card.

## Architecture

```
Browser (/chat page, client component)
  ├─ Text input ──────────────► POST /api/chat ──► createJourneyAgent(db).stream()
  │                                                  │  (ToolLoopAgent: plan_journey,
  │                                                  │   find_last_safe_departure)
  │                                ◄── SSE / UI-message stream ──┘
  │
  └─ Mic button → record (MediaRecorder) → POST /api/transcribe (multipart audio)
                                                  │
                                    ai.transcribe({ model: openai.transcription(modelId),
                                                     audio, providerOptions: { openai: { language } } })
                                                  │
                                    ◄── { text, detectedLanguage } ──┘
                                  (populates the text input; user reviews/edits, then sends
                                   through the same POST /api/chat path as typed text)
```

No new persistence anywhere — matches the backend plan's "nothing is persisted server-side"
stance. Chat history lives in the browser only (React state + `localStorage`).

### New dependency

`@ai-sdk/react` is **not currently installed** (confirmed by reading `node_modules` and
`bun.lock` directly, not assumed) — it must be added for the `useChat` hook. Version should
match the installed `ai` (`^7.0.66`) and `@ai-sdk/openai` (`^4.0.42`) major line.

### `POST /api/chat`

Receives an AI SDK `UIMessage[]` body, calls `createJourneyAgent(db).stream(messages)`,
returns `.toUIMessageStreamResponse()`. This is the shape `useChat`'s default transport
expects natively — no custom protocol.

The client never calls `plan_journey`/`find_last_safe_departure` directly. They're tool calls
the agent makes internally; the client reads the resulting tool-call/tool-result parts out of
the streamed `UIMessage.parts` to find plan data to render. One stream in, render whatever
parts arrive — the client stays dumb.

### `POST /api/transcribe`

Receives `multipart/form-data`: an `audio` file field, an optional `language` field (ISO-639-1,
from the override picker — omitted means auto-detect). Converts the file to `Uint8Array`
(`new Uint8Array(await file.arrayBuffer())` — the installed `ai`/`@ai-sdk/openai` version's
`transcribe()` takes raw bytes, not a `File`/`Blob` directly, confirmed by reading the
installed `.d.ts` files). Calls `transcribe({ model: openai.transcription(modelId), audio,
providerOptions: language ? { openai: { language } } : undefined })`. Returns
`{ text: string, language?: string }` JSON — not streamed, since a transcript is one shot.

Transcription model: default `gpt-4o-transcribe` via an `OPENAI_TRANSCRIBE_MODEL` env var
(same pattern as Task 11's `OPENAI_MODEL`) — no hardcoded/unconfigurable model id. The SDK's
own docs/types don't carry pricing or per-language accuracy comparisons for the available
models (`whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and dated variants) — this
default is a reasonable starting point, not a verified-optimal choice; check OpenAI's own
pricing page before relying on it at any real volume.

### Mock mode

`MOCK_LLM=true` env var, checked at the top of both route handlers.

- `/api/transcribe` in mock mode: returns a canned transcript after a short artificial delay
  (simulating upload+processing), ignoring the actual audio content.
- `/api/chat` in mock mode: a small scripted responder recognizes the demo corridor's
  Ooty→Srivilliputhur query shape and streams back the same canned plan Tasks 9–11's own
  tests already assert (`OOTY_MTP_A → MTP_TPR_A → TPR_MDU_LAST → MDU_SVP_LAST`) — so the mock
  path exercises real demo-corridor data via the real engine (not a fully fabricated response),
  letting the whole UI be verified end-to-end without an OpenAI key or any cost. A query
  outside that recognized shape gets a canned "I don't have real data connected right now"
  reply — mock mode never pretends to be a general-purpose fake LLM.

## Components

```
src/app/chat/page.tsx           — server component shell, renders <ChatWindow>
src/components/chat/
  ChatWindow.tsx                 — client; useChat() hook, message list, input row; persists
                                    messages to localStorage on change, hydrates from it on mount
  MessageBubble.tsx              — one message; assistant messages carrying a plan tool-result
                                    also render <JourneyPlanCard>
  JourneyPlanCard.tsx            — leg-by-leg timeline: stop name → stop name, local time,
                                    confidence badge (safe/tight/risky/broken, colored), and
                                    breakExplanation text (last-safe-departure's warning) when present
  ChatInput.tsx                  — text box + send button + mic button + language picker
  MicButton.tsx                  — MediaRecorder wrapper: tap-to-toggle record (not
                                    press-and-hold — fiddly on mobile, and a journey query
                                    isn't a 2-second utterance); shows recording state; POSTs to
                                    /api/transcribe on stop; fills the text input (user reviews/
                                    edits before sending, so a misheard word can be corrected)
  LanguagePicker.tsx              — small select: Auto / Tamil / Hindi / Telugu / English,
                                    passed to /api/transcribe as the language override
```

Visual design (colors, spacing, typography, the confidence-badge palette, mobile-first
layout) is explicitly routed through the `frontend-design` skill as its own step, once this
structural design is approved — not hand-waved here.

## Error handling

- `/api/transcribe`: empty/silent audio, unsupported format, or a transcription API error →
  `{ error: string }` JSON with a 4xx/5xx status; `MicButton` shows an inline "couldn't hear
  that, try again" rather than failing silently.
- `/api/chat`: the two tools already return no-throw `{ plan: null, narration: "..." }` shapes
  for known failure cases (stop not found, malformed dates — including the fix from the
  backend's final-review fix wave). Anything else that throws (e.g. `OPENAI_API_KEY` missing
  while `MOCK_LLM` is not set) returns a clear error the UI surfaces as a system message in
  the chat, not a silent hang.
- Network/stream errors: `useChat`'s own error state drives a retry affordance in
  `ChatWindow`.

## Testing

- **Backend enrichment**: unit tests on the IST-anchoring math and the new
  `fromStopName`/`departureLocal` fields, following this project's existing pattern (`bun
  test`, real Postgres, demo-corridor fixtures) — no new testing approach, just more of the
  same.
- **API routes**: integration tests hitting the route handlers directly (Next.js route
  handlers are plain functions, testable without a running server) — one for
  `/api/transcribe` in mock mode, one for `/api/chat` in mock mode, verifying the canned
  demo-corridor flow end-to-end.
- **Components**: given no OpenAI credits and no established component-testing setup in this
  repo, component testing stays light for v1 — manual verification via the `run` skill
  (launching the dev server, driving it, screenshotting) in mock mode, rather than standing up
  a new testing framework as part of this feature. Automated component tests can follow later
  if the UI grows.

## Self-review

- **Placeholder scan:** no TBD/TODO markers; every section has concrete file paths, function
  names, and env var names.
- **Internal consistency:** the mock-mode section and the components section agree on what
  drives `JourneyPlanCard` (tool-result parts in the message stream, not a separate fetch);
  the backend-enrichment section's new `JourneyLeg` fields are exactly what
  `JourneyPlanCard`'s description says it renders.
- **Scope check:** this spec is one coherent unit of work (backend enrichment + one chat
  page) — not decomposed further, since the enrichment is a prerequisite the UI can't
  function well without, not an independent deliverable.
- **Ambiguity check:** "human-readable" time format is pinned to a concrete example
  (`"15:40"` IST wall-clock) rather than left vague; the transcription model default is
  explicitly flagged as "a reasonable starting point, not verified-optimal" rather than
  presented as a researched conclusion it isn't.
