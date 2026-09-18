"use client";

// Bottom bar — Scenario ID, API status, and the action cluster
// (Quick Fill, Import CSV, Validate JSON, Reset, Run Optimization).
// The Run CTA calls `onRun` which the parent Harness translates into
// a POST /optimize-energy.

export interface BottomBarProps {
  scenarioId: string;
  onScenarioId: (s: string) => void;
  apiStatus: string;
  onQuickFill: () => void;
  onImportCsv: () => void;
  onValidateJson: () => void;
  onReset: () => void;
  onRun: () => void;
  isRunning: boolean;
  isComplete: boolean;
}

export function BottomBar(props: BottomBarProps) {
  return (
    <footer className="border-t border-border-soft bg-card px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Scenario ID
            <input
              type="text"
              value={props.scenarioId}
              onChange={(e) => props.onScenarioId(e.target.value)}
              className="rounded-md border border-border-soft bg-raised px-3 py-1.5 font-mono text-xs text-zinc-200 focus:border-telemetry-grid focus:outline-none"
            />
          </label>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              API Status
            </p>
            <p className="mt-0.5 font-mono text-xs text-zinc-300 tabular-nums">
              {props.apiStatus}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SecondaryButton onClick={props.onQuickFill}>Quick Fill</SecondaryButton>
          <SecondaryButton onClick={props.onImportCsv}>Import CSV</SecondaryButton>
          <SecondaryButton onClick={props.onValidateJson}>Validate JSON</SecondaryButton>
          <SecondaryButton onClick={props.onReset}>Reset</SecondaryButton>
          <button
            type="button"
            onClick={props.onRun}
            disabled={props.isRunning || props.isComplete}
            className={
              "rounded-lg px-5 py-2 text-sm font-medium transition-opacity " +
              (props.isRunning || props.isComplete
                ? "cursor-not-allowed bg-zinc-700 text-zinc-500"
                : "bg-telemetry-grid text-canvas hover:opacity-90")
            }
          >
            {props.isRunning
              ? "Running…"
              : props.isComplete
                ? "Run Complete ✓"
                : "Run Optimization →"}
          </button>
        </div>
      </div>
    </footer>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-telemetry-grid hover:text-telemetry-grid"
    >
      {children}
    </button>
  );
}