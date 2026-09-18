### Story e02s02: Normalization and paraphrase plus distractor robustness

**type:** feat
**risk:** P0
**context:** domain
**Context**: This story earns the paraphrase-robustness interpretation points by
proving the prompt generalizes beyond its few-shot wording. It authors a
self-owned graded pack (≥3 paraphrases per directive type plus
energy-adjacent distractors, all wording original to the team), adds a
key-gated runner that scores the live endpoint semantically
(type/hours/values, never free text), and tunes `prompt.ts` until the pack is
100% green — while the 20 existing unit tests stay green. No new packages, no
new modules (prompt text + fixtures + runner only).

Zoom-out (modifies `src/lib/llm/prompt.ts`): purpose is the pure per-note
prompt text; callers are `interpretNotes` and prompt unit tests; contracts are
the embedded normalization rules (percent→absolute via capacity,
reduction-vs-remains factor, 12h→end-exclusive-24h), six-type coverage, and
`no_op` guidance. Blast radius is prompt wording + new fixture/runner files;
`directive.ts`, `interpret.ts`, route, and schemas untouched.

## Requirements

#### ADDED: self-authored graded paraphrase pack with runner
Full requirement text: `specs/e2e/paraphrase-pack.json` holds ≥3 original
paraphrases per directive type (solar_reduction, minimum_battery_reserve,
no_charge_window, no_discharge_window, max_grid_window) plus ≥6 distractor
notes (irrelevant chatter, several with energy-adjacent vocabulary), each with
expected `directive_type`, `hours`, and numeric values (factor / kWh / cap).
`specs/e2e/run-paraphrases.sh` posts each note solo against a fixed
battery/hours fixture to the running service, compares semantically
(type exact, hours exact, values within 0.01, `no_op` with null adjustment),
prints a per-case PASS/FAIL report with a total, and exits non-zero unless
100%. The runner requires keys (skips keyless with a clear message). Pack
wording is original — never copied from hidden or public case sets.

#### ADDED: prompt tuned to 100% pack pass without unit regressions
Full requirement text: `prompt.ts` gains targeted normalization guidance and
examples until the pack passes fully: percent-of-capacity conversion,
reduction-vs-remains framing, 12-hour clock conversion, and distractor
rejection under energy-adjacent vocabulary. All 20 existing unit tests stay
green (prompt-content asserts updated only to match intended wording, never
weakened to pass). Live verification via the keyed runner; quota cost is ~24
calls per full pack run.

## Steps

1. Author `specs/e2e/paraphrase-pack.json` (≥18 paraphrases + ≥6 distractors
   with expected semantics) and `specs/e2e/run-paraphrases.sh` (key-gated
   semantic scorer with per-case report); run once to record the baseline
   pass rate
   → verify: `bash specs/e2e/run-paraphrases.sh`
2. Tune `prompt.ts` iteratively against pack failures until the runner exits 0
   with 100%, then run the full gate set (`bun test`, `bun run lint`,
   `bun run build`, `bash specs/e2e/verify-contract.sh`)
   → verify: `bash specs/e2e/run-paraphrases.sh && bun test`

## Verification Script (Step-by-Step)

1. Ensure keys exported (or `.env.local` sourced).
2. `bash specs/e2e/run-paraphrases.sh` → expect 100% PASS, exit 0 (~24 LLM calls).
3. `bun test` → 20+ pass; `bun run lint` + `bun run build` clean.
4. `bash specs/e2e/verify-contract.sh` → `ALL-CHECKS-PASS`.
5. Observation: no pack note copies public/hidden wording; failures (if any)
   show which normalization rule broke.

## Out of scope

- Guardrail acceptance/rejection policy (e03 owns it; pack asserts LLM output
  semantics, not guardrail verdicts).
- New directive types or params (exactly six, fixed).
- Optimizer behavior under the interpreted directives (e04).
- Quota monitoring/automation (e05); keep pack runs deliberate (~24 calls each).

## Risks

- Overfitting to our own pack → mitigated by authoring diverse phrasings per
  type (different clocks, percent styles, distractor topics) and keeping the
  prompt rule-based rather than example-matched.
- Quota burn from tuning loops → mitigated: batch prompt edits between runs,
  ~24 calls/run against 1000+ RPD budgets; record pass rate per run.
- Small-model normalization ceiling (Flash-Lite/Groq free models) → detect
  early: baseline run in step 1 shows per-rule gaps; persistent failures after
  tuning become a model-upgrade decision, not more prompt text.
- Rationalization caught: "tune until green on our own cases proves nothing
  hidden" — true, but it is the only available rehearsal for the 5
  paraphrase points; diversity of authorship is the lever.
