"use client";

import type { DirectiveKind } from "@/lib/ui/sample-data";
import { directiveBadgeClass } from "@/lib/ui/sample-data";

// Directive Interpretation — one card per operator note showing
// whether the LLM interpretation was applied or marked as no_op. The
// type drives the badge color; the structured_adjustment gives the
// reviewer enough context to audit the call.

export interface DirectiveCard {
  note_index: number;
  applies: boolean;
  directive_type: DirectiveKind | string;
  structured_adjustment: unknown;
}

export interface DirectiveInterpretationProps {
  cards: DirectiveCard[];
}

const KIND_LABELS: Record<string, string> = {
  solar_reduction: "SOLAR REDUCTION",
  minimum_battery_reserve: "MINIMUM BATTERY RESERVE",
  no_charge_window: "NO CHARGE WINDOW",
  no_discharge_window: "NO DISCHARGE WINDOW",
  max_grid_window: "MAX GRID WINDOW",
  no_op: "NO-OP",
};

export function DirectiveInterpretation({ cards }: DirectiveInterpretationProps) {
  if (cards.length === 0) {
    return (
      <section className="rounded-xl border border-border-soft bg-card p-5">
        <header className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-50">Directive Interpretation</h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            LLM ↔ GUARDRAIL ↔ OPTIMIZER
          </span>
        </header>
        <p className="mt-3 text-sm text-zinc-500">
          No directives were interpreted for this run.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border-soft bg-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-50">Directive Interpretation</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          LLM ↔ GUARDRAIL ↔ OPTIMIZER
        </span>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.note_index}
            className="rounded-lg border border-border-soft bg-raised p-3"
          >
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span>NOTE {pad(c.note_index + 1)}</span>
              <span
                className={
                  "rounded border px-2 py-0.5 " +
                  (c.applies
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-500/40 bg-zinc-500/10 text-zinc-400")
                }
              >
                {c.applies ? "APPLIED" : "NO-OP"}
              </span>
            </div>

            <p
              className={
                "mt-2 inline-block rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider " +
                badgeFor(c.directive_type)
              }
            >
              {KIND_LABELS[c.directive_type] ?? c.directive_type}
            </p>

            <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-canvas p-2 font-mono text-[10px] leading-4 text-zinc-300">
              {JSON.stringify(c.structured_adjustment, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function badgeFor(kind: string): string {
  const allowed: DirectiveKind[] = [
    "solar_reduction",
    "minimum_battery_reserve",
    "no_charge_window",
    "no_discharge_window",
    "max_grid_window",
    "no_op",
  ];
  return (allowed as string[]).includes(kind)
    ? directiveBadgeClass(kind as DirectiveKind)
    : "border-zinc-500/40 bg-zinc-500/10 text-zinc-400";
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}