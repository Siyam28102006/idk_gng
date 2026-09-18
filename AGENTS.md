<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# GridWise — AI Agents

GridWise is an LLM-assisted Smart Campus Energy Optimization API for BUP CSE Fest 2026.
Single public HTTP service: LLM interprets 1–3 operator notes → deterministic guardrails
validate → LP/MILP optimizer solves 24h dispatch → final validator replays → JSON response.
Stack: Next.js 16.3.5 App Router, React 19, Tailwind CSS v4, TypeScript 5, Bun 1.4.2.

Canonical docs: `GridWise_PRD (1).md` (synthesis). Problem Statement is canonical for
schemas/guardrails/battery/optimization; Participant Guide is canonical for
execution/deployment/scoring. UI mockups in `stitch_gridwise_energy_optimization_ui.zip`
are a dev/test harness only — judges score the API, not the UI (PRD §2.2 API-only).

## Commands

| Action | Command |
|--------|---------|
| Run dev | `bun run dev` |
| Build | `bun run build` |
| Start prod | `bun run start` |
| Lint | `bun run lint` |
| Install | `bun install` |
| Health check | `curl localhost:3000/health` |

Bun-only repo (`packageManager: bun@1.4.2`, `bun.lock` committed). Do not add npm/pnpm/yarn lockfiles.

## Architecture

```
Energy Data + Operator Notes
  → LLM Interpreter (note → candidate structured directive, MUST be real LLM call)
  → Guardrail Validator (deterministic, no LLM — untrusted output never bypasses)
  → Math Optimizer (LP/MILP, e.g. HiGHS — UI references HiGHS, MILP Core v2.4)
  → Final Validator (hour-by-hour replay of hourly_plan vs directives + physics)
  → API Response
```

Route placement (App Router): root-level contract, NOT under `/api`:

- `src/app/health/route.ts` → `GET /health` → 200 `{"status":"ok"}` within 60s of cold start
- `src/app/optimize-energy/route.ts` → `POST /optimize-energy`, must complete <30s, target p95 ≤5s
- `src/lib/llm/` — prompt + structured-output parsing (one entry per note)
- `src/lib/guardrails/` — pure deterministic validation, zero LLM imports
- `src/lib/optimizer/` — LP formulation + solver adapter
- `src/lib/validate/` — final replay + totals recomputation
- Any `/page.tsx` dashboard (Scenario Builder / Results) is a local harness only

## API Contract (scored — do not drift)

Status codes: `200` success · `400` malformed JSON/structurally invalid · `422` optional
well-formed-but-semantically-invalid · `500` controlled internal, no secrets/stack traces.
No auth/VPN. Both endpoints externally reachable for the full evaluation window.

Request `POST /optimize-energy`:

```json
{
  "scenario_id": "string",
  "operator_notes": ["1-3 non-empty strings"],
  "hours": [{"hour": 0, "demand_kwh": 0, "solar_kwh": 0, "tariff_bdt_per_kwh": 0}],
  "battery": {"capacity_kwh": 0, "initial_energy_kwh": 0, "minimum_energy_kwh": 0,
    "max_charge_kwh_per_hour": 0, "max_discharge_kwh_per_hour": 0}
}
```

Exactly 24 entries, hours 0–23 unique.

Response: `scenario_id` echo · `directive_interpretation` (exactly one entry per note,
ascending `note_index`, no missing/duplicates) · `hourly_plan` (exactly 24 entries with
`hour, grid_kwh, solar_used_kwh, battery_action: charge|discharge|idle, battery_kwh,
battery_energy_after_kwh`) · `total_grid_kwh, total_cost_bdt, peak_grid_kwh`
(exactly recomputable from `hourly_plan` within 0.01) · `plan_summary`.
`battery_kwh` must be 0 when `battery_action="idle"`. `explanation` is free text, never graded verbatim.

## Directive Types (exactly these six — hidden tests never add a seventh)

| Type | `structured_adjustment` | Effect |
|------|-------------------------|--------|
| `solar_reduction` | `{"hours":[...], "factor": number}` | `effective_solar[h] = solar[h] * factor` |
| `minimum_battery_reserve` | `{"hours":[...], "minimum_energy_kwh": number}` | `energy_after[h] >= max(base_min, directive_min)` |
| `no_charge_window` | `{"hours":[...]}` | charge = 0 in hours |
| `no_discharge_window` | `{"hours":[...]}` | discharge = 0 in hours |
| `max_grid_window` | `{"hours":[...], "max_grid_kwh": number}` | `grid_kwh[h] <= max_grid_kwh` |
| `no_op` | `null` | no change; ONLY type allowed with `applies=false` |

Rules: hours are unique ints 0–23, ascending, start-inclusive end-exclusive
("1 PM–3 PM" → `[13,14]`). `factor` = fraction that REMAINS (80% reduction → 0.2).
Normalize percentages ("50% of capacity" → absolute kWh via `capacity_kwh`),
12h-clock phrasing, and reduction-vs-remains framing. Irrelevant chatter
("cafeteria menu…") → `no_op`, even with energy-adjacent vocabulary.

## Guardrails (deterministic, LLM output is untrusted until it passes ALL)

Allowed `directive_type` ∈ six values · `note_index` maps 1:1 to an existing note ·
hours unique/ascending/0–23 · `0 ≤ factor ≤ 1` · reserve finite, ≥0, ≤ capacity ·
grid cap finite, ≥0 · no invented demand/tariff/battery params or new directive types ·
`no_op ⇔ applies=false ∧ adjustment=null`, all others `applies=true` + correct shape ·
malformed output → controlled fallback (retry with corrective re-prompt OR safe
`no_op`/flagged state), never crash, never emit unvalidated directive.

## Optimizer Hard Constraints (every hour, every case — validity gates all cost credit)

1. Balance: `grid + solar_used + discharge = demand + charge`
2. `0 ≤ solar_used ≤ effective_solar` (post-reduction)
3. `minimum_energy(h) ≤ energy_after ≤ capacity` (raised by active reserve)
4. charge ≤ max_charge, discharge ≤ max_discharge
5. `no_charge`/`no_discharge` windows force 0
6. `max_grid_window` caps `grid_kwh`
7. End-of-day neutrality: `energy_after[23] = initial_energy` (hard LP constraint, not post-check)
8. `grid_kwh ≥ 0`, no export

Objective: minimize `Σ grid_kwh[h] * tariff[h]`. Tolerance 0.01 kWh / 0.01 BDT.
Keep solve comfortably inside 30s timeout / 5s p95 — concise prompts, warm LLM client,
fast solver, internal timeouts.

## UI Harness (reference only — `stitch_gridwise_energy_optimization_ui.zip`)

Two screens + `gridwise/DESIGN.md`. Build only after the API is green; never let harness
work break the contract above.

- **Scenario Builder**: battery config (capacity/initial/min/charge/discharge limits +
  end-of-day neutrality note), 24h scenario matrix (demand/solar/tariff table + curves),
  Operator Directives panel (1–3 notes, e.g. SAMPLE-07 solar_reduction + reserve, + third-note
  cap), Validate JSON / Import CSV / Quick Fill, `Run Optimization →`, 30s budget + p95 ≤5s footer.
- **Optimization Results**: totals (total grid kWh, total cost BDT, peak draw) + sparklines,
  Directive Interpretation cards (`APPLIED solar_reduction hours:[13,14] factor:0.2`,
  `APPLIED minimum_battery_reserve hours:[17,18,19,20]`, `NO-OP … applies:false`),
  24h dispatch chart (solar used / grid import / charge+ / discharge− / SoC line with
  directive windows shaded), Executive Dispatch Summary (pre-charge off-peak, solar
  prioritization, neutrality `Initial SoC = Final SoC`), Run Again / Copy JSON / Export CSV.

Design tokens (dark-only): canvas `#0B0F17`, card `#111827`, raised `#161F30`,
borders `#1F2937/#374151`; telemetry solar `#F59E0B`, battery `#10B981`, grid `#38BDF8`,
fault `#EF4444`; directive badges solar-amber, reserve-emerald, no_charge-violet `#8B5CF6`,
no_discharge-rose `#F43F5E`, max_grid-cyan `#06B6D4`, no_op-slate. Fonts:
`Plus Jakarta Sans` headings, `Inter` body, `JetBrains Mono` all numerals with
`tabular-nums`. Cards `rounded-xl`, tiles `rounded-lg`, pills `rounded-full` 24px with
6px status dot. No decorative gradients; 1px borders over shadows.

## Conventions

- TypeScript strict; validate requests with schema (e.g. zod) at the route boundary.
- Guardrail + final-validator modules are pure functions — no fetch, no LLM SDK imports.
- Log LLM raw output, guardrail pass/fail reason, solver status per request; never log secrets.
- Secrets via env names only (`.env.example` with names, never values); nothing baked into images.
- Keep the simplest working implementation; no preventive abstraction.

## Test

- `bun run build` + `bun run lint` must pass before any commit.
- Replay all 10 public sample cases locally: interpretation semantics + schedule feasibility
  + recomputed totals + neutrality + timing <30s.
- Self-authored paraphrases (≥3 per directive type), energy-adjacent distractors,
  malformed bodies (expect 400), garbage LLM output (guardrail safe-failure), provider
  outage (controlled failure <30s), rapid-fire repeats (no 5xx).
- Verdict order per case: true-directive interpretation → plan obeys true directive →
  physics/validity → only then cost quality (`min(1, optimal/team)`).

## Never

- Never bypass the LLM on the note→directive path (LLM-only-for-summary is disqualifying).
- Never use hard-coded phrase matching as the sole interpreter; never hard-code case IDs,
  note wording, or reference schedules.
- Never let unvalidated LLM output reach the optimizer; never invent a directive type or params.
- Never break the request/response schema, ordering, or `scenario_id` echo.
- Never commit secrets, `.env` values, `*.zip`, or `GridWise_PRD*.md` (gitignored — local only).
- Never dismiss a reproducible build/lint/test failure as pre-existing.

## Env Setup (names only — values never committed)

| Var (`.env.local`, gitignored) | Purpose | Source |
|---|---|---|
| `OPENROUTER_KEY` / `OPENROUTER_MODEL` (default `nex-agi/nex-n2.5-pro:free`) | operator-note interpretation, primary; team owns quota/rate limits for the full judging window | OpenRouter dashboard |
| `GEMINI_KEY` / `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) | interpretation fallback when OpenRouter fails; same quota ownership | Google AI Studio |
| `NEXT_PUBLIC_INSFORGE_URL` / `NEXT_PUBLIC_INSFORGE_ANON_KEY` | local harness persistence ONLY — never on the scored request path | `oss_host` in `.insforge/project.json` / `npx @insforge/cli secrets get ANON_KEY` |

- `.env.example` lists NAMES only. Docker receives secrets via `docker run -e VAR=…`, never baked into the image.
- LLM provider DECIDED (was PRD §8.1 open): OpenRouter primary + Gemini
  fallback via Vercel AI SDK structured output; strict json_schema verified
  live on the default model. Model ids must also be documented in README
  (separately graded).
- The scored `/optimize-energy` path must not call InsForge at request time — every
  extra hop costs p95 and adds a scored failure mode. InsForge is for the local
  dev harness (sample runs, result logging) if used at all.

## Deployment + Docker

- One public service exposing BOTH endpoints, no auth/VPN, stable for the entire
  evaluation window. `/health` → 200 `{"status":"ok"}` within 60s of cold start.
- `Dockerfile`: bun-based, `bun run start`, `EXPOSE` the documented port, listen on
  `0.0.0.0`, zero secrets inside. Push `registry/name:<immutable-tag>` (digest ideal,
  never `latest`); verify from a clean machine with cold `docker pull` + the exact
  documented `docker run` command, then `curl /health`.
- Internal timeouts on LLM + solver so `/optimize-energy` always answers <30s —
  controlled fallback/500, never a hang (a timeout is an automatic failure).

## Testing Workflow (public pack: `BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json`)

Pack shape: `{_meta, cases[10]}`, each `{id, label, input, expected_output, rationale}`.
Per case: POST `input` → compare `directive_interpretation` semantics (free text need
not match) → replay `hourly_plan` against the TRUE directives + physics → recompute
totals within 0.01 → check neutrality → record wall time (<30s, target p95 ≤5s).

| Case | Notes → expected semantics |
|---|---|
| SAMPLE-01 solar + distractor | `solar_reduction` [12,13] factor 0.25 · `no_op` |
| SAMPLE-02 charge maintenance | `no_charge_window` [2,3,4] |
| SAMPLE-03 % reserve | `minimum_battery_reserve` [18,19,20] 100 kWh (= 50% of 200 capacity) |
| SAMPLE-04 discharge protection | `no_discharge_window` [18,19] |
| SAMPLE-05 feeder cap | `max_grid_window` [18,19,20] ≤ 155 kWh |
| SAMPLE-06 multi + distractor | solar [10,11] factor 0.5 · `no_charge` [14,15] · `no_op` |
| SAMPLE-07 reserve + cap (stacked) | reserve [18,19,20,21] 90 kWh · max_grid [19,20] ≤ 180 |
| SAMPLE-08 charge/discharge outages | `no_charge` [11,12] · `no_discharge` [17,18] |
| SAMPLE-09 reduction wording | solar [11,12,13] factor 0.2 (80% reduction → 0.2 REMAINS) |
| SAMPLE-10 evening multi (stacked) | reserve [18,19,20,21] 80 kWh · max_grid [19,20,21] ≤ 190 · `no_op` |

- Beyond the pack: ≥3 self-authored paraphrases per directive type, energy-adjacent
  distractors, malformed bodies (expect 400), garbage-LLM output (guardrail safe-fail,
  no crash), provider-outage drill (controlled failure <30s), rapid-fire repeats (no 5xx).
- NEVER assert byte-equality with reference schedules — equivalent-optimal is valid.
  Never import pack IDs, wording, or values into product code (rule-violation risk).

## Submission Checklist (each box protects scored points)

- [ ] Live endpoint reachable externally, both routes, no auth — Deployment
- [ ] Docker image pinned tag/digest, cold-pull + `/health` rehearsed — Deployment
- [ ] README passes clean-machine rehearsal: setup, env NAMES, model id + LLM role,
  guardrails, solver, run command, `/health` + `/optimize-energy` curls, one sample
  test, deps, limitations — Documentation (10 pts)
- [ ] All 10 pack cases + paraphrase/distractor/outage/load drills green — 25+25+10 pts
- [ ] Repo private during event → public right after deadline; history contains no
  secrets, `*.zip`, or PRD files
- [ ] 3-minute video uploaded/linked (tie-break only) — record LAST, after API is green

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **IDK_GnG** (API base `https://jvdy4y9s.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.
- **MCP server:** configured in `opencode.json` (local-only, gitignored — holds the backend API key). Restart the agent to load the `insforge` MCP tools (`fetch-docs`, `fetch-sdk-docs`, `download-template`, `run-raw-sql`, `get-backend-metadata`, …). Before writing any InsForge integration code, call `fetch-docs` (`"instructions"` first, then the feature doc) — never guess the SDK API.
- **Note:** this repo uses Tailwind CSS v4 (per scaffold). Ignore any generic guidance suggesting v3.4.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
