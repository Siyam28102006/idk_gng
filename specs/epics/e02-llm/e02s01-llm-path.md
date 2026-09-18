### Story e02s01: Real per-note LLM call producing the six-type structured directive

**type:** feat
**risk:** P0
**context:** domain
**Context**: This story puts the real LLM on the note→directive path, replacing
the e01 tracer stub. One structured-output call per note via the Vercel AI SDK
(pinned `ai@^7`): current live API (ai-sdk.dev, v7 docs, verified 2026-09-18)
is `generateText({ model, output: Output.object({ schema }), prompt })`
returning `{ output }`, with schema failures raising typed
`NoObjectGeneratedError` (`.isInstance` check; carries text/response/usage/
cause). Groq free tier is primary (`LLM_API_KEY`/`LLM_MODEL`), Gemini Flash
free tier is the fallback (`LLM_FALLBACK_API_KEY`/`LLM_FALLBACK_MODEL`) behind
the same interface. Calls run in parallel (`Promise.all`, ≤3 notes) with a
10s per-call abort; any LLM failure is a controlled generic 500 — e05 upgrades
this to the flagged `no_op` fallback. New module `src/lib/llm/` is the only
place that imports the AI SDK, so guardrail/validator purity stays enforceable
by construction. (Reason for Depth: single seam for provider switch, fallback,
timeout, and test doubles.)

Zoom-out (modifies `src/app/optimize-energy/route.ts`): route purpose is the
HTTP boundary (parse→validate→interpret→plan→respond); callers are the Next
runtime, route tests, and the e2e script; contracts preserved are the exact
§5.7 schema, ascending `note_index`, 200/400/422/500 mapping, and leak-free
errors. Blast radius: route call-site (stub→interpreter swap), new
`src/lib/llm/*`, tests, `.env.example`. Impact note (assess-impact substance):
no downstream modules exist yet (guardrails e03, optimizer e04 consume the
candidate shape defined here); the e01 suite must stay green — achieved via
test doubles (below), not by weakening asserts.

## Requirements

#### ADDED: zod directive-candidate schema covering exactly the six types
Full requirement text: `src/lib/llm/directive.ts` exports a zod schema for
one candidate directive: `solar_reduction {hours, factor}`,
`minimum_battery_reserve {hours, minimum_energy_kwh}`,
`no_charge_window {hours}`, `no_discharge_window {hours}`,
`max_grid_window {hours, max_grid_kwh}`, `no_op` (null adjustment). A seventh
type never validates. Pure module — no AI SDK import.

#### ADDED: pure prompt builder with battery context and type coverage
Full requirement text: `buildPrompt(note, battery)` embeds the six
directive types, `no_op` guidance with a distractor example, normalization
rules (percent-of-capacity via `capacity_kwh`, reduction-vs-remains factor,
12h→end-exclusive-24h hours), and 2–3 few-shot examples. Pure, unit-tested.

#### ADDED: per-note interpreter with parallel calls, timeout, typed errors
Full requirement text: `interpretNotes(notes, battery, client?)` issues one
SDK structured-output call per note in parallel, aborts each after 10s,
validates each result against the candidate schema, preserves note order, and
throws typed `LlmError` (timeout | validation | provider) on any failure. The
default client tries Groq primary then Gemini fallback; errors never leak
provider internals. Route maps `LlmError` to generic 500 (e05 refines this).

#### ADDED: hermetic tests via SDK test doubles, live path gated on keys
Full requirement text: Unit/integration tests use the AI SDK's documented
testing mock (see ai-sdk.dev `/docs/ai-sdk-core/testing`; exact export
verified at build, fetch-interceptor fallback) so `bun test` needs no key,
no network, no quota. A live end-to-end check (one solar note → validated
` solar_reduction` entry) runs only when `LLM_API_KEY` is set, skipped
otherwise. `.env.example` gains the four `LLM_*` names (values never
committed). No key material in code, logs, or responses.

## Steps

1. Add `src/lib/llm/directive.ts` (candidate zod schema) + `src/lib/llm/
   prompt.ts` (pure builder) with unit tests for six-type coverage, seventh-
   type rejection, capacity embedding, `no_op` guidance; install `ai@^7`,
   `@ai-sdk/groq`, `@ai-sdk/google` (all [OK]: Vercel-maintained, documented
   Next.js support; exact model ids verified against provider docs at build)
   → verify: `bun test tests/llm.test.ts`
2. Add `src/lib/llm/interpret.ts` (client interface, primary/fallback,
   10s abort, `Promise.all` order, typed errors) + wire route
   (stub→`interpretNotes`, `LlmError`→generic 500); route tests run through
   `POST(Request)` with the SDK mock so the e01 suite stays green
   → verify: `bun run build`
3. Add `.env.example` names, extend `specs/e2e/verify-contract.sh` with a
   key-gated live-LLM section, run full gates incl. coverage of new modules
   → verify: `bash specs/e2e/verify-contract.sh`

## Verification Script (Step-by-Step)

1. `bun test` → all green with no `LLM_*` env set (proves hermetic doubles).
2. With keys set: `LLM_API_KEY=… LLM_MODEL=… bash specs/e2e/verify-contract.sh`
   → live section asserts a solar-maintenance note yields a validated
   `solar_reduction` entry and the plan still replays feasible.
3. `bun run lint` + `bun run build` clean; `grep -ri 'sk-\|api[_-]key.*=.\(...\)' src/`
   finds no key material.
4. Observation: no `src/lib/guardrails` or `src/lib/validate` file imports
   `ai` or `@ai-sdk/*` (purity holds for e03).

## Out of scope

- Paraphrase/distractor robustness tuning (e02s02, builds on this seam).
- Guardrail acceptance semantics (e03 owns 400/422 policy + fallback).
- Retry/backoff policy beyond one fallback attempt, quota monitoring, 500→
  flagged-`no_op` refinement (all e05).
- README model-id documentation (e06 delivery).

## Risks

- AI SDK v7 API drift since this plan → detect in step 1: docs re-checked at
  build; version pinned in package.json; mock export verified before use.
- Groq/Gemini model-id churn → detect in step 1: ids verified against live
  provider docs; fallback provider covers primary outage/404.
- Free-tier 429s during judging → mitigated by fallback provider + per-call
  timeout; e05 adds the outage drill. First signal: live e2e latency/retry logs.
- Rationalization caught: "mock-heavy tests prove little" — countered by the
  key-gated live e2e section, which exercises the true provider path.
