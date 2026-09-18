# Audit — e03s01 (Pure guardrail validator with safe fallback)

**Branch:** `feat/e03s01-guardrails`
**Base:** `0fc13ee chore(state): checkpoint before kickoff`
**Verifier:** audit-code (self-review)
**Date:** 2026-09-18
**Result:** **PASS**

## Section results

| Section | Result |
|---|---|
| Supply Chain & Security | PASS |
| Provenance & Metadata | PASS |
| Law of Demeter | PASS |
| CONVENTIONS.md Compliance | PASS |
| Scope | PASS |
| Types and Safety | PASS (1 intentional `as T` cast, documented) |
| Test Coverage | PASS |
| SOLID and Heuristics | PASS (1 documented duplication: TS-narrowing-mandated) |
| Refactoring Smells (Fowler) | PASS |
| Code Style | PASS (1 documented 3-level indent, alternative rejected) |
| Red Flags | 6 rationalizations named, all caught and decided |

## Rationalizations caught (silent ones explicitly)

1. "Skip the per-branch `flaggedNoOp` 3-line repetition" → kept: preserves TypeScript's discriminated-union narrowing visibility.
2. "Optimize the four `flaggedNoOp` calls into a one-liner with `??`" → rejected: would lose the per-call return shape the case branches rely on.
3. "Combine the uniqueness + ordering passes into one loop" → rejected: current code allocates one Set, O(n). Already optimal for ≤24 entries.
4. "Add an `Index` enum to FallbackReason" → rejected: the string union is the contract; enum would over-couple callers.
5. "Inline `note_index_gap` reason (future story)" → rejected: TDD says don't speculate. Enum stays minimal.
6. "Skip the `as T` cast via per-type helpers" → rejected: would re-widen the discriminated union and reintroduce the TS error from Cycle 2. Cast is bounded by `<T extends { hours: readonly number[] }>`.

## Documented design decisions (intentional, not bugs)

### 1. `as T` cast in `hoursCheck` (`validate.ts:44`)

```ts
return { ok: true, adj: { ...adj, hours: h.hours } as T };
```

The `{ ...adj, hours: h.hours }` spread can't preserve the generic `T` through heterogeneous keys — TypeScript widens it back to the discriminated union. The `as T` cast is bounded by the function signature `<T extends { hours: readonly number[] }>`, so it cannot widen beyond the input's shape. An alternative (per-type helpers) would lose narrowing and reintroduce the build error resolved during Cycle 2.

### 2. Per-type `case` duplication in `validateOne` (`validate.ts:64-156`)

Each of the four operating branches (`solar_reduction`, `minimum_battery_reserve`, `no_charge_window`/`no_discharge_window` joined, `max_grid_window`) repeats the pattern:

```
if (!boundsCheck(adj)) return flaggedNoOp(...);
const h = hoursCheck(adj);
if (!h.ok) return flaggedNoOp(...);
return { ok: true, directive: { ... c.directive_type, applies, structured_adjustment: h.adj } };
```

This is mandatory duplication: each branch accesses type-specific shape keys (`adj.factor`, `adj.minimum_energy_kwh`, `adj.max_grid_kwh`) that TypeScript's discriminated-union narrowing makes visible *only inside the case block*. Extracting the pattern to a generic helper would erase the narrowing.

### 3. `validateOne` case branches reach 3 indent levels (G24 normally says max 2)

Same root cause as #2: the `switch` + `case` + `if`/`else-if` + body indents are necessary for type narrowing. A per-type named-helper dispatch (e.g. `validateSolarReduction(adj, i)`) would re-flatten the indentation but move the narrowing *out of* `validateOne`, where each branch's rationale becomes invisible. Kept inline.

## Non-blocking follow-ups (not bugs, noted for future stories)

1. **Worktree `node_modules`** — `git worktree add` does not propagate `node_modules`. e03s01 worked around by copying from the main tree. Documented in `kickoff-branch` outcome. If the issue recurs, formalize the workaround in the skill.
2. **`fallback_reasons` log volume in prod** — adversarial LLM output × 3 notes × per-request could spam server logs. e05 reliability story owns this; may batch or sample.

## Compliance summary

- 0 secrets in diff
- 0 OWASP Top 10 injection vectors
- 0 `any` introduced; `unknown[]` for LLM-derived data is correct
- 0 `@ts-ignore` or `eslint-disable`
- 32 tests (10 in guardrails, all passing)
- 0 HIGH findings with confidence ≥ 8
- All `tests/guardrails.test.ts` exercises are T8-compliant (test public interface `validateGuardrails`, not private helpers)
- All response errors remain generic strings; no stack traces, no note text, no LLM internals in logs/responses
- The route's existing 200/400/422/500 mapping preserved
- Purity invariant verified: `src/lib/guardrails/` has zero `ai`/`@ai-sdk/*` imports

## Recommendation

Run `commit-message` (the next skill in the pipeline), then `request-review` for an independent second-opinion check focused on design and architecture (the simplify-style hygiene is covered above).
