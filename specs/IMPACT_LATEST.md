## Target
`src/lib/validate/validate-plan.ts` (final replay validator) + `src/lib/llm/prompt.ts` (time-window rule)

## Dependents (2)
- `src/app/optimize-energy/route.ts`: sole caller of `validatePlan`; rejects plan → 500 instead of shipping invalid schedule
- `src/lib/optimizer/*`: no code dependency, but validator mirrors its math (effective solar, floors, caps, neutrality)

## Affected Stories
- e03 (guardrails + final validation): validator now replays base minimum, rate limits, base/effective solar caps, SoC transitions
- e02 (LLM path): prompt gains end-exclusive evening examples; no interface change

## Test Coverage
- `tests/validate-plan.test.ts`: 29 tests (5 new: base-min, charge-rate, discharge-rate, base solar cap, SoC transition); 1 pre-existing test corrected (charge/discharge pair keeps SoC consistent)
- `tests/sample-cases.test.ts`: unchanged, still green
- Gap: prompt wording has no unit test (requires live LLM); verified by repeated live probes (6/6 on SAMPLE-05/07/10 windows)

## Risk: Medium
Pure-function validator with one caller and full test coverage; prompt text change is quota-free and latency-neutral. Live-probe evidence: 10/10 TRUE-pack optimizer plans + 10/10 reference schedules validate; LLM 10/10 exact semantics on first full pass; E2E HTTP 200 in 2.4–3.1s.

## Recommended action
Proceed → verify-work (full 10-case E2E sweep) → release-branch (solo-local merge to main)
