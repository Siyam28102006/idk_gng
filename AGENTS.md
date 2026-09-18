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
