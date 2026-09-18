### Story e01s02: Request validation and controlled error codes

**type:** feat
**risk:** P1
**context:** domain
**Context**: e01s01 built the validation and error mapping; e01s02 pins the
remaining contract boundaries with tests and fixes any red pin minimally via
TDD. Expected outcome is test-only additions (schemas + route already reject
these shapes), but any pin that fails becomes a RED→GREEN fix cycle keeping
all 9 e01s01 tests green. No new dependencies, no new abstractions.

Zoom-out: `src/app/optimize-energy/route.ts` (HTTP boundary; callers: Next
runtime, route tests, e2e script; contracts: exact §5.7 schema, 200/400/422/500
mapping, leak-free errors) and `src/lib/schemas.ts` (shared zod schema;
caller: route only; contract: accept exactly the §5.2 shape in any hour order).
Blast radius is these two modules plus tests — no downstream modules exist yet.

## Requirements

#### ADDED: scenario_id boundary validation
Full requirement text: Empty-string and non-string `scenario_id` values are
rejected with controlled 400 carrying a generic `error` string and no
internals. The valid echo path (`scenario_id` echoed verbatim on 200) is
already pinned by e01s01 and must stay green.

#### ADDED: battery shape validation pins
Full requirement text: Negative battery values, zero `capacity_kwh`, and
missing battery fields are rejected with controlled 400. The semantic
`minimum > capacity` and initial-out-of-bounds 422s already pinned by e01s01
must stay green.

#### ADDED: non-object JSON body rejection
Full requirement text: Top-level JSON string, array, null, and numeric bodies
are rejected with controlled 400 and a generic `error` string (zod shape
mismatch, not a crash, no stack leak).

## Steps

1. Add `bun:test` pins for empty/non-string `scenario_id` → 400; fix route or
   schema minimally only if a pin is red, keeping e01s01 suite green
   → verify: `bun test tests/optimize-energy.test.ts`
2. Add `bun:test` pins for battery shape violations (negative, zero capacity,
   missing field) and non-object bodies (string/array/null/number) → 400;
   extend e2e asserts for one malformed shape; run full gates
   → verify: `bash specs/epics/e01-contract/verify-e01s01.sh`

## Verification Script (Step-by-Step)

1. Run `bun test` → expect all tests pass (9 prior + new pins).
2. Run `bun run lint` and `bun run build` → expect clean.
3. Run `bash specs/epics/e01-contract/verify-e01s01.sh` → `ALL-CHECKS-PASS`.
4. Observation: every 400/422 body is `{error: string}` with no `stack`;
   no valid request regressed to an error.

## Out of scope

- 400-vs-422 policy redesign (deliberate pass owned by e03 guardrails).
- GET/405 handling (framework default, not product code).
- Real LLM interpretation (e02), optimizer (e04), timeouts/logging (e05).

## Risks

- A pin reveals an over-strict schema (e.g. rejecting a valid edge) → detect
  immediately: pin fails as 400-vs-200 mismatch; fix schema, re-run suite.
- Rationalization caught: "too simple to plan" — plan kept proportionate
  (two tasks, pins first, code only on red).
