### Story e01s01: Tracer — health plus optimize skeleton with schema-valid feasible plan

**type:** feat
**risk:** P0
**context:** domain
**Context**: This story proves the scored HTTP plumbing end to end on the existing
Next.js 16 App Router scaffold: `GET /health` and `POST /optimize-energy` as
root-level routes with strict request/response schemas. Interpretation is a temporary
stub (one `no_op` per note) and the schedule is a trivially feasible plan (solar first,
grid for the remainder, battery idle); epic e02 replaces the stub with the real LLM
call before anything shippable. No solver, no LLM SDK, no new abstraction beyond one
shared zod schema module.

## Requirements

#### ADDED: GET /health returns 200 {"status":"ok"}
Full requirement text: `GET /health` responds HTTP 200 with exactly
`{"status":"ok"}` within 60s of cold start. No auth.

#### ADDED: POST /optimize-energy accepts the exact request schema
Full requirement text: Request carries `scenario_id` (string), `operator_notes`
(1–3 non-empty strings), `hours` (exactly 24 entries, hours 0–23 unique), and
`battery` (`capacity_kwh`, `initial_energy_kwh`, `minimum_energy_kwh`,
`max_charge_kwh_per_hour`, `max_discharge_kwh_per_hour`). Malformed JSON or
structural violations return controlled 400 with no secrets or stack traces.

#### ADDED: POST /optimize-energy returns the exact response schema
Full requirement text: Response echoes `scenario_id`; `directive_interpretation`
holds exactly one entry per note in ascending `note_index` order (tracer: all
`no_op`, `applies=false`, `structured_adjustment=null`); `hourly_plan` holds
exactly 24 entries with `hour, grid_kwh, solar_used_kwh, battery_action,
battery_kwh, battery_energy_after_kwh`; `battery_kwh` is 0 when
`battery_action="idle"`; `total_grid_kwh, total_cost_bdt, peak_grid_kwh` are
exactly recomputable from `hourly_plan` within 0.01; plus free-text
`plan_summary`. Tracer schedule: `solar_used=min(demand,solar)`,
`grid=demand-solar_used`, battery idle at `initial_energy` (feasible when the
request's initial energy sits within [minimum, capacity], enforced by validation).

## Steps

1. Install zod [OK] (mature maintained schema library, suggested by AGENTS.md) via
   `bun add zod`, add `src/lib/schemas.ts` with request/response zod schemas, add
   `src/app/health/route.ts` with `GET` returning `Response.json({status:"ok"})`
   per `node_modules/next/dist/docs` route-handler pattern
   → verify: `bun run lint`
2. Add `src/app/optimize-energy/route.ts` with `POST`: parse JSON (catch →
   controlled 400), validate with zod (fail → 400), build stub `no_op`
   interpretation plus trivial feasible 24h plan with recomputed totals, return
   200; unexpected faults → secret-free 500
   → verify: `bun run build`
3. Write `specs/epics/e01-contract/verify-e01s01.sh` (start `bun run start`,
   curl `/health`, POST one 2-note sample, assert echo/order/counts/idle-zero/
   recomputed totals) and run it green
   → verify: `bash specs/epics/e01-contract/verify-e01s01.sh`

## Verification Script (Step-by-Step)

1. Run `bun run build` then `bun run start`.
2. `curl localhost:3000/health` → expect 200 `{"status":"ok"}`.
3. `bash specs/epics/e01-contract/verify-e01s01.sh` → expect all asserts pass.
4. Observation: response validates against the §5.7 schema; totals match a manual
   recompute; battery stays idle at initial energy; run finishes in seconds.

## Out of scope

- Real LLM interpretation (epic e02, mandatory before submission — tracer stub alone
  would violate the LLM-path hard requirement).
- Guardrail/final-validator modules (epic e03), LP optimizer (epic e04),
  timeouts/logging/load hardening (epic e05), README/Docker/deploy/video (epic e06).
- Advancing SoC, charging, or directive-aware dispatch — battery stays idle.

## Risks

- zod version drift breaking `bun run build` → detect in step 1 via lint.
- Port 3000 occupied during local verify → detect in step 3; script fails loudly.
- Stub mistaken for shippable interpretation → mitigated by this spec's explicit
  e02-replacement note and `plan_summary` stating "tracer stub".
