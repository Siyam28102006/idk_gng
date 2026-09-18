### Story e03s01: Pure guardrail validator with safe fallback

**type:** feat
**risk:** P0
**context:** domain
**Context**: This story puts the deterministic guardrail validator between the
LLM interpreter (e02) and the LP optimizer (e04). The validator is a pure
function that takes the LLM's structured-output candidates plus the original
notes and battery context, decides whether each candidate is acceptable, and
returns either a validated directive list (one entry per note, ascending
`note_index`, every cross-cutting rule enforced) or a list whose malformed
entries have been reduced to a flagged `no_op`. PRD §Guardrails (scored) and
PRD §Guardrails say "malformed output → controlled fallback (retry with
corrective re-prompt OR safe `no_op`/flagged state), never crash, never emit
unvalidated directive" — this story delivers the safe-`no_op` branch; the
corrective-retry branch is owned by e05. New module `src/lib/guardrails/` is
the only consumer of `directiveSchema` outside `src/lib/llm/` and the only
producer of the validated shape that the optimizer will see. (Reason for
Depth: single seam for safe-failure semantics, the rule set that holds the
LLM's output accountable, and the per-note note↔directive 1:1 contract that
the API schema relies on.)

Zoom-out (modifies `src/app/optimize-energy/route.ts` and
`tests/optimize-energy.test.ts`): route purpose is the HTTP boundary
(parse→validate→interpret→guardrail→plan→respond); callers are the Next
runtime, route tests, and the e2e script; contracts preserved are the exact
PRD §5.7 schema, ascending `note_index`, 200/400/422/500 mapping, and
leak-free errors. Blast radius: route call-site (raw candidates →
guardrail-validated directives), new `src/lib/guardrails/*`, route tests
(unchanged behaviour for the existing "happy path" since the stub already
returns `no_op` for the two sample notes), no new dependencies. Impact note
(assess-impact substance): the only downstream consumer is e04's optimizer
which does not exist yet — the validated shape this story defines becomes
its input contract.

## Requirements

#### ADDED: pure guardrail module enforcing the six rules and the 1:1 note contract
Full requirement text: `src/lib/guardrails/validate.ts` exports a pure
`validateGuardrails(candidates, notes, battery)` function. Inputs:
`DirectiveCandidate[]` (from `src/lib/llm/directive.ts`), the original note
strings in the order the API received them, and the parsed `BatteryContext`.
Output: a discriminated union — on success
`{ ok: true; directives: ValidatedDirective[] }` where
`ValidatedDirective` carries the same shape as `DirectiveCandidate` plus an
explicit `applies` boolean (derived from `directive_type !== "no_op"`) and a
`note_index` in `0..notes.length-1`; on partial failure
`{ ok: true; directives: ValidatedDirective[] }` where the malformed entries
have been replaced with flagged `no_op` (see task e03s01t02). Pure module —
no `fetch`, no `ai`, no `@ai-sdk/*` imports. Enforced rules:

1. Allowed `directive_type` is exactly the six values (already covered by
   the LLM schema; the guardrail re-asserts and is the second line of
   defence).
2. `note_index` maps 1:1 to an existing note (length matches; indices
   unique, ascending, contiguous `0..notes.length-1`).
3. Hours arrays are unique integers, sorted ascending, each in `0..23`.
4. `solar_reduction.factor` in `[0, 1]`.
5. `minimum_battery_reserve.minimum_energy_kwh` is finite and within
   `[0, battery.capacity_kwh]`.
6. `max_grid_window.max_grid_kwh` is finite and `>= 0`.
7. `no_op` is the only type allowed with `applies=false`; every other type
   must have a non-null `structured_adjustment` whose shape matches its
   `directive_type` (re-checked against `directiveSchema` for defence in
   depth).

#### ADDED: flagged `no_op` fallback for malformed LLM output
Full requirement text: When `validateGuardrails` cannot make a candidate
conform to the rules above, it substitutes a flagged `no_op` with
`applies=false` and `structured_adjustment=null`, and emits a
`fallback_reasons: string[]` array (one entry per reduced note, each entry
an internal tag from a fixed enum such as
`"hours_out_of_range" | "hours_unsorted" | "factor_out_of_range" |
"reserve_out_of_bounds" | "cap_negative" | "note_index_gap" |
"shape_invalid"`) so the route can log the reason without leaking it to
the client. The function never throws, never emits an unvalidated
directive, and always returns a `directives` array of length
`notes.length`. The `fallback_reasons` array is part of the returned
result and is the only side-channel to the route.

## Steps

1. Add `src/lib/guardrails/types.ts` with the `ValidatedDirective`,
   `GuardrailOk`, `GuardrailResult` discriminated union, and the
   `FallbackReason` string-enum type. Pure types, no runtime code beyond
   type-only exports. → verify: `bun run build`

2. Add `src/lib/guardrails/validate.ts` with the pure `validateGuardrails`
   implementation that imports only `directiveSchema` and
   `BatteryContext` from `src/lib/llm/directive.ts`. The function enforces
   the seven rules above in one pass, accumulating
   `fallback_reasons` entries. On a structurally-invalid candidate
   (discriminator mismatch or per-type shape violation) the entry is
   reduced to `no_op` rather than failing the whole request. The output's
   `note_index` is set by position in the input `notes` array (not
   trusted from the candidate, which the LLM does not control anyway).
   → verify: `bun test tests/guardrails.test.ts`

3. Add `tests/guardrails.test.ts` with table-driven unit cases covering
   each rule, the 1:1 note mapping contract, and the fallback path
   (malformed candidate → flagged `no_op`; request still returns a
   full-length validated list). Also add one integration test that
   proves the route's "happy path" behaviour is preserved (sample notes →
   `no_op` for both via the stub; totals unchanged).
   → verify: `bun test`

4. Wire `src/app/optimize-energy/route.ts` to call
   `validateGuardrails(candidates, input.operator_notes, input.battery)`
   after `interpretNotes` returns and before any optimizer call. The
   route builds `directive_interpretation` from
   `validated.directives` (with `applies` and `structured_adjustment`),
   logs the `fallback_reasons` array server-side (generic strings, no
   note text, no LLM internals), and continues to respond 200 with the
   same external schema. No new 4xx/5xx mapping is added in this story —
   the validator never fails the request, by design (PRD §Guardrails:
   "never crash, never emit unvalidated directive").
   → verify: `bun test tests/optimize-energy.test.ts`

5. Run `bun run lint` + `bun run build` to confirm the new module
   imports nothing from `ai`, `@ai-sdk/google`, or
   `@ai-sdk/openai-compatible`; confirm guardrails is pure.
   → verify: `bun run lint`

## Verification Script (Step-by-Step)

1. `bun test tests/guardrails.test.ts` → all rule-coverage cases green:
   six-type happy path, factor `[-0.1, 1.5]` rejected, hours `[24, -1,
   5, 5]` rejected with the right `fallback_reasons`, reserve
   `[-1, capacity+1]` rejected, cap negative rejected, note-count
   mismatch replaced with flagged `no_op`, no throw on any input.
2. `bun test` → full suite green; the existing
   `tests/optimize-energy.test.ts` "happy path" still asserts
   `directive_type === "no_op"` for both sample notes and recomputes
   totals within 0.01.
3. `bun run build` → succeeds with the new module; no AI SDK imports
   under `src/lib/guardrails/`.
4. `grep -r "from \"ai\\|from \"@ai-sdk" src/lib/guardrails/` → empty
   (purity invariant holds for e04's optimizer).
5. `bun run lint` → clean.
6. Observation: a malformed-hours candidate becomes a flagged `no_op`
   with `applies:false` and a `fallback_reasons` entry
   `"hours_out_of_range"`; the rest of the request still 200s.

## Out of scope

- Final hour-by-hour replay validator (e03s02 — recomputes totals and
  rejects mismatches before responding).
- Corrective retry with re-prompt on malformed LLM output (e05
  reliability — e05 owns the retry/backoff policy).
- 4xx mapping for guardrail violations (intentional — the safe-`no_op`
  branch is the only path this story ships; a future hardening story
  may opt in to a hard-422 policy).
- Optimizer integration (e04 consumes the validated shape).

## Risks

- "Safe `no_op` allows garbage through" — countered by the
  `fallback_reasons` enum + per-request server log so the judge-run
  anomalies are visible without leaking to the client. First signal:
  the integration test in step 3 asserts the fallback array shape.
- "Guardrail purity regresses on a future edit" — countered by the
  grep step (5) in the verification script and the absence of any
  network/SDK import surface in the module.
- Rationalization caught: "skip the fallback_reasons enum, just log a
  string" — the enum is a contract surface for e05 (it needs to map
  reasons to retry decisions) and a guarantee that no note text or
  LLM internals leak into logs.
