# Security review — e01s01 tracer (branch feat/e01s01-tracer, HEAD a02c53f)

Scope: GET /health, POST /optimize-energy (zod validation, stub no_op
interpretation, trivial idle plan), tests, e2e script. No auth by design
(both endpoints public per contract). No LLM, no solver, no storage, no
external calls in this slice.

Findings (inline review + dual-blind review rounds 1-3):
- No secrets, keys, or env values in code, tests, logs, or responses.
  Errors are generic {error} strings; 422 test asserts no stack-trace leak.
- Injection: only input is JSON body parsed by request.json() and
  constrained by zod (finite numbers, string lengths, fixed shapes).
  No eval, no SQL, no shell, no HTML rendering.
- Auth/session: none exists; nothing to bypass. No PII handled.
- DoS: trivial O(24) work per request; timeouts/rate limits deferred to e05.
- Uncovered lines 90-91 (catch-all 500) are defensive-unreachable after
  validation; return a generic message with no internals.

HIGH findings with confidence >= 8: none.
EXCEPTIONS.md: not required (no unresolved HIGH).
Fresh as of: 2026-09-18, branch HEAD a02c53f.

---

# Security review — e02s01 LLM path (branch feat/e02s01-llm-path)

> SUPERSEDED in part by e02s02: provider chain is now OpenRouter → Gemini
> (`OPENROUTER_KEY`/`GEMINI_KEY`); Groq/`LLM_API_KEY` references below are
> e02s01-era. Findings otherwise stand.

Scope: new `src/lib/llm/` (directive schema, prompt builder, interpreter with
Groq-primary/Gemini-fallback via AI SDK, 9s per-attempt + 20s per-note
timeouts, fail-closed stub in production), route wiring, `.env.example`
(names only). External network calls introduced (first in repo).

Findings (inline review + dual-blind review rounds 1-2):
- Secrets: keys read from env only; `.env.example` values-free; `.env.local`
  gitignored and verified untracked; diff grepped for key patterns — clean.
  No key material in code, logs (one warn/error on stub path, no values), or
  responses (LlmError kinds map to generic 500 strings).
- Prompt injection: operator note interpolated inside `<operator_note>` tags
  with an untrusted-data instruction; output constrained by SDK structured
  output + local `safeParse`. Residual semantic-jailbreak risk accepted with
  e03 guardrails as the owning control (documented, not unresolved).
- Fail-open risk closed: production without keys throws (500), never 200 no_op.
- SSRF/injection: no URLs, shell, SQL, or HTML built from input. Deps
  `ai@7`, `@ai-sdk/groq`, `@ai-sdk/google` are Vercel-maintained [OK].
- Availability: per-attempt + per-note timeouts bound LLM wall time inside the
  30s budget; quota/outage drills owned by e05.

HIGH findings with confidence >= 8: none.
EXCEPTIONS.md: not required (no unresolved HIGH).
Fresh as of: 2026-09-18, branch feat/e02s01-llm-path.

---

# Security review — e02s02 chain + pack (branch feat/e02s02-normalization)

Delta since e02s01: OpenRouter+Gemin chain (`OPENROUTER_KEY`/`GEMINI_KEY`
+ legacy `LLM_*` aliases), strict json_schema via `supportsStructuredOutputs`
(live-verified), 26-case paraphrase pack + runner, AGENTS.md env table synced.
`@ai-sdk/groq` removed; `@ai-sdk/openai-compatible` added ([OK]).

Findings (inline review + dual-blind review rounds 1-2):
- Secrets: names-only `.env.example`; both `.env.local` copies gitignored;
  committed tree grepped for key patterns — clean. A pasted-keys-in-`.env`
  working-tree incident was caught pre-commit; history verified clean.
- Injection: hostile-instruction pack notes (distract-08/09) return `no_op`
  live; untrusted-data instruction + delimiters in prompt; schema + e03
  guardrails (pending) as backstops.
- Availability: timeouts unchanged; pack runs are deliberate (~26 calls).

HIGH findings with confidence >= 8: none.
EXCEPTIONS.md: not required (no unresolved HIGH).
Fresh as of: 2026-09-18, branch feat/e02s02-normalization.

---

# Security review — e03s01 guardrail validator (branch feat/e03s01-guardrails)

Scope: new pure module `src/lib/guardrails/` (types.ts, validate.ts), route
wire-up in `src/app/optimize-energy/route.ts`, table-driven tests
`tests/guardrails.test.ts`, and a small loosening of `src/lib/llm/directive.ts`
(`factor.min/max`, `minimum_energy_kwh.nonnegative`, `max_grid_kwh.nonnegative`
relaxed to `.finite()` — per-type bounds now owned by the guardrail, the single
source of truth). No new dependencies, no network surface, no LLM call site
changes.

Findings (inline review + grep-based purity invariant + diff inspection):
- Secrets: branch diff grepped for `sk-`, `ghp_`, `AKIA` — clean. No env
  reads introduced.
- Purity invariant re-verified: `grep -rn "from \"ai\|from \"@ai-sdk"
  src/lib/guardrails/` returns 0 matches. Validator is a pure function over
  its three arguments; no fetch, no fs, no globals, no Date.now.
- Prompt injection: unchanged from e02s02 — the guardrail is downstream of
  the LLM output and tightens, never loosens, what the route accepts.
- Information disclosure on fallback: `fallback_reasons` entries log only
  `{note_index, reason}` enum (server-side `console.warn`). Note text, LLM
  internals, and per-request payloads stay out of logs and never appear in
  the response.
- Type-level bounds removed from the LLM schema (`factor` no longer `.max(1)`,
  `reserve` no longer `.nonnegative()`, `cap` no longer `.nonnegative()`).
  Per-type bounds are now in the guardrail. Out-of-range values still cannot
  reach the optimizer: the guardrail's `fallback_reasons` catches them and
  reduces the entry to `no_op`. Defense-in-depth contract is preserved by
  the LLM schema still enforcing structural shape (integer hours in 0..23,
  finite numbers) and by a test that pins hours-range as
  `shape_invalid` (LLM-schema-owned).
- DoS / availability: per-request work is O(n) over the candidate list
  (≤24 entries). No new loops, no allocations on hot paths beyond the
  documented `Set` for uniqueness.
- 0 `any` introduced; 0 `@ts-ignore`; 0 `eslint-disable`. The single `as T`
  cast is bounded by the helper's generic constraint
  `<T extends { hours: readonly number[] }>` and cannot widen beyond the
  input's shape.

HIGH findings with confidence >= 8: 0
MEDIUM: 0
LOW: 1
LOW detail: `directiveSchema` no longer enforces per-type bounds at the type
  level — the guardrail does. Out-of-range values still cannot reach the
  optimizer; `fallback_reasons` logs the typed reason (not the value). No
  client-facing leak. Documented in AUDIT-e03s01.md §Types and Safety.
EXCEPTIONS.md: not required (no unresolved HIGH).
Fresh as of: 2026-09-18, branch feat/e03s01-guardrails (HEAD 476339d).

---

# Security review — e06s01 (branch feat/e06-delivery, HEAD 9a3bfdd)

Scope: README rewrite, Dockerfile + .dockerignore, delivery-contract
tests, local UI harness (10 React components), pure helpers.

Findings (inline review, no `security-review` skill available):

- No secrets in README (delivery-contract test 2 enforces no secret
  values); only documented model ids.
- .env.example has NAMES only (delivery-contract test 3 enforces).
- Dockerfile: pinned base `oven/bun:1.4.2` (not `:latest`); no ENV
  lines carrying secrets; USER bun (non-root); CMD ["bun","run","start"];
  EXPOSE 3000; secrets passed at `docker run -e` per AGENTS.md.
- .dockerignore blocks .git, .env*, .insforge, PRD/sample .json, *.zip.
- Harness client components render JSON via `<pre>` (React-escaped, no
  innerHTML). Operator notes are rendered only via `<input>` /
  `<textarea value>` (auto-escaped). No `<form action>` injection.
- No new I/O surface; the existing /optimize-energy route contract is
  unchanged (covered by e03–e05 reviews).
- The harness posts to `/optimize-energy` (relative URL); the server
  enforces schema validation (400 on malformed/empty hours) and
  battery-bounds (422 on min > capacity) before any LLM call.

HIGH findings with confidence >= 8: none.
EXCEPTIONS.md: not required.
