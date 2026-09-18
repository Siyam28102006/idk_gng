"use client";

// Three metric tiles: Total Grid Import (kWh), Total Optimization
// Cost (BDT), Peak Grid Draw (kWh). Numbers come from the response
// body; deltas are not yet computed (results reflect the solver, not
// a baseline).

export interface MetricTilesProps {
  totalGridKwh: number;
  totalCostBdt: number;
  peakGridKwh: number;
}

export function MetricTiles({ totalGridKwh, totalCostBdt, peakGridKwh }: MetricTilesProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Tile
        label="Total Grid Import"
        value={totalGridKwh.toFixed(2)}
        unit="kWh"
        color="text-telemetry-grid"
      />
      <Tile
        label="Total Optimization Cost"
        value={totalCostBdt.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        unit="BDT"
        color="text-telemetry-battery"
      />
      <Tile
        label="Peak Grid Draw"
        value={peakGridKwh.toFixed(2)}
        unit="kWh"
        color="text-amber-400"
      />
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <article className="rounded-xl border border-border-soft bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className={"mt-2 font-mono text-3xl font-semibold tabular-nums " + color}>
        {value}{" "}
        <span className="text-sm text-zinc-500">{unit}</span>
      </p>
    </article>
  );
}