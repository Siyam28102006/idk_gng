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
