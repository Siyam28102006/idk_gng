"use client";

// Top bar matches the stitch shell — brand mark, version pill,
// scenario tag, gateway label, and view tabs. The tabs drive the
// `view` state in the parent Harness.

export type View = "scenario" | "results";

export interface TopBarProps {
  view: View;
  onView: (v: View) => void;
  status: "idle" | "running" | "complete" | "error";
}

export function TopBar({ view, onView, status }: TopBarProps) {
  return (
    <header className="flex items-center justify-between border-b border-border-soft bg-card px-6 py-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-telemetry-grid/10 text-telemetry-grid font-mono text-xs">
          ⚡
        </span>
        <span className="font-semibold text-zinc-50">GridWise</span>
        <span className="rounded border border-border-strong px-2 py-0.5 font-mono text-[10px] text-zinc-400 tabular-nums">
          V1.0
        </span>
        <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
          BETA
        </span>
        <span className="rounded bg-telemetry-grid/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-telemetry-grid">
          CAMPUS
        </span>
      </div>

      <div className="flex items-center gap-6">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          API Gateway · Next.js · HiGHS LP
        </span>

        <nav className="flex items-center gap-1 rounded-lg border border-border-soft bg-raised p-0.5">
          <button
            type="button"
            onClick={() => onView("scenario")}
            className={
              "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
              (view === "scenario"
                ? "bg-card text-zinc-50"
                : "text-zinc-400 hover:text-zinc-200")
            }
          >
            Scenario Builder
          </button>
          <button
            type="button"
            onClick={() => onView("results")}
            disabled={status !== "complete"}
            className={
              "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
              (view === "results"
                ? "bg-card text-zinc-50"
                : status === "complete"
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-600 cursor-not-allowed")
            }
          >
            Optimization Results
          </button>
        </nav>

        <span
          className={
            "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider " +
            statusBadge(status)
          }
        >
          {statusLabel(status)}
        </span>

        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">Docs →</span>
      </div>
    </header>
  );
}

function statusBadge(s: "idle" | "running" | "complete" | "error"): string {
  switch (s) {
    case "idle":
      return "border border-border-strong text-zinc-400";
    case "running":
      return "border border-cyan-500/40 bg-cyan-500/10 text-cyan-400";
    case "complete":
      return "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "error":
      return "border border-telemetry-fault/40 bg-telemetry-fault/10 text-telemetry-fault";
  }
}

function statusLabel(s: "idle" | "running" | "complete" | "error"): string {
  switch (s) {
    case "idle":
      return "Idle";
    case "running":
      return "Run in Progress";
    case "complete":
      return "Run Complete";
    case "error":
      return "Run Failed";
  }
}