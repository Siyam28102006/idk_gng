# GridWise — LLM-assisted Smart Campus Energy Optimization API

Single public HTTP service for the BUP CSE Fest 2026 preliminary. Judges score the
**API** (`POST /optimize-energy` + `GET /health`); a local UI harness is optional.

Pipeline (deterministic, defense-in-depth):

```
Operator Notes (1-3)
  → LLM Interpreter        (Vercel AI SDK, structured output)
  → Guardrail Validator    (pure deterministic; flags bad LLM output as no_op)
  → LP Optimizer           (HiGHS WASM, 24h dispatch, neutrality constraint)
  → Final Validator        (replay totals + physics + directive compliance)
  → JSON Response
```

## Setup

Bun 1.4.2 is the only runtime. The repo is bun-only (`bun.lock` committed).

```bash
bun install          # restore deps (highs, next, react, zod, ai-sdk, ...)
bun run lint         # eslint
bun test             # 112 tests (unit + sample replay + delivery contract)
bun run build        # next build → .next/
bun run start        # production server (default port 3000; PORT env to override)
```

For local development:

```bash
bun run dev          # next dev with hot reload
```

## Environment

Secrets live in `.env.local` (gitignored). **Never commit values.** `.env.example`
lists NAMES only and is safe to commit.

| Name | Purpose | Default |
|------|---------|---------|
| `OPENROUTER_KEY` | Primary LLM (note interpretation) | — |
| `OPENROUTER_MODEL` | Primary model id | `nex-agi/nex-n2.5-pro:free` |
| `GEMINI_KEY` | Fallback LLM | — |
| `GEMINI_MODEL` | Fallback model id | `gemini-3.5-flash-lite` |
| `PORT` | Override default port (3000) | — |

Legacy aliases still accepted: `LLM_API_KEY` (= OpenRouter), `LLM_MODEL` (=
OpenRouter), `LLM_FALLBACK_API_KEY` (= Gemini), `LLM_FALLBACK_MODEL` (= Gemini).

Chain order is configured by which keys are present (first configured wins).
With no keys set, the service **fails closed in production** (returns 500) and
falls back to a deterministic `no_op` stub outside production so dev still works.

## Endpoints

### `GET /health`

Liveness probe. Always 200 within 60s of cold start.

```bash
curl -i http://localhost:3000/health
# HTTP/1.1 200 OK
# {"status":"ok"}
```

### `POST /optimize-energy`

24-hour dispatch plan. Always answers within 30s; target p95 ≤ 5s.

```bash
curl -sS http://localhost:3000/optimize-energy \
  -H 'content-type: application/json' \
  -d '{
    "scenario_id": "demo",
    "operator_notes": ["no special instructions"],
    "hours": [
      {"hour":0,"demand_kwh":40,"solar_kwh":0,"tariff_bdt_per_kwh":5},
      {"hour":1,"demand_kwh":38,"solar_kwh":0,"tariff_bdt_per_kwh":5},
      ... (24 entries, hours 0..23 unique)
    ],
    "battery": {
      "capacity_kwh": 200,
      "initial_energy_kwh": 100,
      "minimum_energy_kwh": 0,
      "max_charge_kwh_per_hour": 100,
      "max_discharge_kwh_per_hour": 100
    }
  }'
```

Status codes:

| Code | Meaning |
|------|---------|
| 200  | Success — see response shape below |
| 400  | Malformed JSON or structurally invalid body |
| 422  | Well-formed but semantically invalid (e.g. battery min > capacity) |
| 500  | Controlled internal error (LLM, optimizer, validator) |
| 504  | Pipeline exceeded 25s ceiling |

Response (always includes all keys; `hourly_plan` length is exactly 24):

```json
{
  "scenario_id": "demo",
  "directive_interpretation": [
    {"note_index":0,"applies":false,"directive_type":"no_op","structured_adjustment":null,"explanation":"..."}
  ],
  "hourly_plan": [
    {"hour":0,"grid_kwh":40,"solar_used_kwh":0,"battery_action":"idle","battery_kwh":0,"battery_energy_after_kwh":100},
    ... (24 entries)
  ],
  "total_grid_kwh": 960,
  "total_cost_bdt": 4800,
  "peak_grid_kwh": 40,
  "plan_summary": "Dispatched across 24h: 0 charging hours, 0 discharging hours; 0 directive(s) applied."
}
```

`total_grid_kwh`, `total_cost_bdt`, `peak_grid_kwh` are recomputable from
`hourly_plan` within 0.01 tolerance (PRD §5.7). `battery_kwh` is 0 whenever
`battery_action = "idle"`.

## Directive types (six total, no others)

| Type | Adjustment | Effect |
|------|------------|--------|
| `solar_reduction` | `{hours:[...], factor:number}` | `effective_solar[h] = solar[h] * factor` (factor = fraction REMAINS) |
| `minimum_battery_reserve` | `{hours:[...], minimum_energy_kwh:number}` | raises the per-hour SoC floor |
| `no_charge_window` | `{hours:[...]}` | forces charge = 0 in hours |
| `no_discharge_window` | `{hours:[...]}` | forces discharge = 0 in hours |
| `max_grid_window` | `{hours:[...], max_grid_kwh:number}` | caps `grid_kwh` per hour |
| `no_op` | `null` | no change; only type allowed with `applies=false` |

Hours are unique ints 0–23, ascending. The LLM must NOT invent a seventh type
or new params; the guardrail rejects them with `flagged no_op`.

## Guardrails (deterministic, untrusted LLM output never reaches optimizer)

- Six directive types only
- Hours unique/ascending/0..23
- `0 ≤ factor ≤ 1` (fraction that REMAINS)
- `0 ≤ minimum_energy_kwh ≤ capacity`
- `max_grid_kwh ≥ 0`
- `note_index` is 1:1 with an existing note
- Malformed output → flagged `no_op` with a typed `fallback_reason`; never crashes

Guardrail + validator modules are pure functions — no fetch, no LLM SDK imports.

## Solver (HiGHS)

`highs@1.15.3` via WebAssembly (`highs` package). 24h × 5 variables per hour
(grid, solar_used, charge, discharge, SoC) = 120 LP variables per request.
Hard constraints baked in (PRD §5.5):

1. Balance: `grid + solar_used + discharge = demand + charge`
2. `0 ≤ solar_used ≤ effective_solar`
3. `minimum_energy(h) ≤ energy_after ≤ capacity`
4. charge ≤ max_charge, discharge ≤ max_discharge
5. `no_charge` / `no_discharge` windows force 0
6. `max_grid_window` caps grid
7. End-of-day neutrality: `energy_after[23] = initial_energy` (LP constraint, not post-hoc)
8. `grid_kwh ≥ 0` (no export)

Objective: minimize `Σ grid_kwh[h] * tariff[h]`. Solve time: ~10–40 ms.

## Sample test (one liner)

After `bun install`:

```bash
bun test tests/sample-cases.test.ts
```

Runs SAMPLE-01 through SAMPLE-10 through the optimizer + validator and
asserts semantic properties (neutrality, directive compliance, totals
recompute within 0.01). Designed so judges can clone + install + run with
zero configuration.

## Dependencies

Runtime: `next@16.3.5`, `react@19.2.8`, `zod@4.6.5`, `highs@1.15.3`,
`ai@7.0.106`, `@ai-sdk/openai-compatible@3.0.52`, `@ai-sdk/google@4.0.75`.

Build: `typescript@5`, `tailwindcss@4`, `eslint@9`.

Bun-only — no npm/pnpm/yarn lockfile.

## Limitations

- No authentication. The service is intentionally open per scoring rules.
- Single-region LP solver (HiGHS WASM is single-threaded inside the worker).
- LLM quota is bounded by the team's provider plan; the pipeline caps each
  provider attempt at 9s and total pipeline at 25s.
- The local UI harness (`stitch_gridwise_energy_optimization_ui.zip`) is a
  dev convenience; judges score the API only.

## Docker

```bash
docker build -t gridwise:<tag> .
docker run -p 3000:3000 -e OPENROUTER_KEY=... -e GEMINI_KEY=... gridwise:<tag>
docker exec -it <container> curl http://localhost:3000/health
```

The image:
- pins `oven/bun:1.4.2` (no `:latest`)
- listens on `0.0.0.0:3000`
- exposes port 3000
- has zero secrets inside (env vars passed at run time)
- runs `bun run start` (production server)

## Scoring-relevant facts

- `/health` returns 200 within 60s of cold start, no auth.
- `/optimize-energy` returns within 30s; target p95 ≤ 5s.
- Status codes: 200 / 400 / 422 / 500 (504 only on overall timeout).
- Response shape: `scenario_id` echo + `directive_interpretation` (1:1 with notes,
  ascending `note_index`) + `hourly_plan` (24 entries) + totals (recomputable
  from `hourly_plan` within 0.01) + `plan_summary`.
- No stack traces, no secrets, no LLM internals in any response body.
- All 10 SAMPLE cases + paraphrases + distractor + outage + rapid-fire drills
  covered by `tests/sample-cases.test.ts` and `tests/optimize-energy.test.ts`.
