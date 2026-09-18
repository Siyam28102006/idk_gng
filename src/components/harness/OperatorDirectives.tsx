"use client";

// Operator Directives card — 1–3 free-text notes parsed by the LLM
// at request time. Each note maps to a typed directive (see
// lib/guardrails/validate). Notes are stored in parent state and
// sent verbatim in `operator_notes`.

export interface OperatorDirectivesProps {
  notes: string[];
  onChange: (next: string[]) => void;
}

export function OperatorDirectives({ notes, onChange }: OperatorDirectivesProps) {
  const slots = [0, 1, 2];

  return (
    <section className="rounded-xl border border-border-soft bg-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-50">Operator Directives</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          ≤ 3 NOTES · LLM INTERPRET
        </span>
      </header>

      <div className="mt-4 space-y-3">
        {slots.map((i) => {
          const filled = i < notes.length;
          return (
            <div key={i} className="rounded-lg border border-border-soft bg-raised p-3">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <span>NOTE {pad(i + 1)}</span>
                <span className="text-zinc-600">{filled ? "ACTIVE" : "EMPTY"}</span>
              </div>
              <textarea
                rows={3}
                value={notes[i] ?? ""}
                onChange={(e) => {
                  const next = notes.slice();
                  while (next.length < i) next.push("");
                  next[i] = e.target.value;
                  onChange(next);
                }}
                placeholder={
                  i === 0
                    ? "e.g. PV output drops to 20% between 13:00 and 15:00."
                    : i === 1
                      ? "e.g. Keep battery reserve above 50 kWh from 17:00 to 21:00."
                      : "Optional third directive…"
                }
                className="mt-2 w-full resize-none rounded-md border border-border-soft bg-canvas p-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-telemetry-grid focus:outline-none"
              />
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-5 text-zinc-500">
        The LLM maps each note to one of six directive types:
        <span className="ml-1 font-mono text-zinc-400">solar_reduction</span>,
        <span className="ml-1 font-mono text-zinc-400">minimum_battery_reserve</span>,
        <span className="ml-1 font-mono text-zinc-400">no_charge_window</span>,
        <span className="ml-1 font-mono text-zinc-400">no_discharge_window</span>,
        <span className="ml-1 font-mono text-zinc-400">max_grid_window</span>,
        <span className="ml-1 font-mono text-zinc-400">no_op</span>.
      </p>
    </section>
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}