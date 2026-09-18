# Research — LLM provider for e02 (2026-09-18, live sources)

Task: choose the model/API behind the per-note note→directive call.
Constraints from PRD §8.1 + AGENTS.md: real LLM on the path (disqualifying if
absent), structured-output mode, concise prompts (30s timeout, p95 ≤ 5s),
team-owned quota for the full judging window, outage fallback, secrets via env
names only, exact model id documented in README.

## Prior Art

| Candidate | Source | Verdict | Notes |
|-----------|--------|---------|-------|
| Vercel AI SDK `ai` + zod `generateObject`/`Output.object` | https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data (live, incl. AI SDK 7 notes) | adopt | Unified provider API ("switch models by changing two lines"), zod schema in → typed validated object out, typed `NoObjectGeneratedError` on schema failure. ESM-only since v7 — fine in Next route handlers (documented Next.js support). Caution: APIs moved across majors (v7 folds structured output into `generateText` `output:`); pin version + verify spelling at implementation. |
| Groq free tier (Llama 3.3 70B class) | https://console.groq.com/docs/rate-limits + 2026 tier guides (live) | extend (primary) | 30 RPM / ~1k RPD free, no card; OpenAI-compatible endpoint; JSON mode + structured output; LPU inference very fast (p95-friendly). Limits per org, 429s possible → needs retry/backoff + fallback. Model IDs churn — verify exact id at build time. |
| Google Gemini Flash/Flash-Lite free tier | https://ai.google.dev/gemini-api/docs/pricing + rate-limits (live) | extend (fallback) | Free input+output tokens; Flash ~10 RPM / 1500 RPD, Flash-Lite ~15 RPM / 1000 RPD; native `response_mime_type` + `response_schema` structured output. Lower RPM than Groq; free-tier cuts happened Dec 2025 — quota varies by project (check AI Studio). Same AI-SDK interface → two-line fallback switch. |
| OpenRouter / direct OpenAI / Anthropic | registry knowledge, no free tier to rely on | build-only-if-funded | Pay-go removes quota risk but needs funded key for the whole window; keep as env-swappable third option, not the plan. |
| Local Ollama / local model | common pattern, no call needed | consider (tertiary) | Zero quota risk, but team must host it next to the deployment for the full window; small-model normalization quality (percent math, 12h clock) unverified. Only if time remains after e04. |
| Hard-coded phrase matching as interpreter | PRD §4 (explicitly non-compliant) | build (rejected) | Hidden notes are paraphrased; phrase-match sole path is disqualifying-adjacent. Deterministic normalization around the LLM is fine and expected. |

opensrc: not usable here (`npx opensrc` has no `search`; helper scripts absent).
Repo: no LLM code yet; `zod@4.6.5` already installed composes directly with the
AI SDK schema path. No bigpowers skill covers LLM-provider integration.

## Quota math (judging window)

Worst case 3 LLM calls per request (one per note). Groq 1000 RPD ≈ 330+
requests/day free; Gemini Flash 1500 RPD ≈ 500. A 4-hour judging window with
tens of cases plus repeats fits comfortably. Binding risk is burst RPM
(rapid-fire repeats): Groq 30 RPM > Gemini 10–15 RPM → Groq primary.
Per-note calls can run sequentially (~1s each on Groq, ~3s total, inside
budget) or `Promise.all` for latency at some RPM cost — e02s01 decision.

## Recommendation (needs user sign-off)

1. Adopt `ai` SDK (pinned version, verified at build) with zod directive schema.
2. Primary: Groq free tier (`LLM_API_KEY`, `LLM_MODEL` = verified Llama-class id).
3. Fallback: Gemini Flash free tier (`LLM_FALLBACK_API_KEY`,
   `LLM_FALLBACK_MODEL`) behind the same interface + 429/timeout retry.
4. Outage drill (e05): provider error → corrective retry once → flagged `no_op`
   fallback, always < 30s, never crash, never unvalidated output.
5. Exact model ids + quota screenshots go in README (separately graded).

## Open questions for the user

- Approve Groq-primary / Gemini-fallback on free tiers, or fund a pay-go key?
- Who owns key creation + quota monitoring during the judging window?
