"use client";

import type { HourRow } from "@/lib/ui/sample-data";
import { chartPath } from "@/lib/ui/sample-data";

// 24-Hour Scenario Matrix — three stacked area sparklines (Demand,
// Solar PV, Peak Tariff) and a tabular interval view below. The
// matrix is the operator-facing view of the envelope sent to the
// optimizer; clicking a row focuses that hour in the Results view.

export interface ScenarioMatrixProps {
  hours: HourRow[];
  onSelectHour?: (h: number) => void;
  selectedHour?: number | null;
}

const W = 720;
const H = 64;

export function ScenarioMatrix({ hours, onSelectHour, selectedHour }: ScenarioMatrixProps) {
  const demand = hours.map((h) => h.demand_kwh);
  const solar = hours.map((h) => h.solar_kwh);
  const tariff = hours.map((h) => h.tariff_bdt_per_kwh);

  return (
    <section className="rounded-xl border border-border-soft bg-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-50">24-Hour Scenario Matrix</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          INTERVAL · 60 min
        </span>
      </header>

      <div className="mt-4 space-y-3">
        <Trace label="Demand" color="#38BDF8" values={demand} unit="kWh" />
        <Trace label="Solar PV" color="#F59E0B" values={solar} unit="kWh" />
        <Trace label="Peak Tariff" color="#10B981" values={tariff} unit="BDT" />
      </div>

      <div className="mt-5 max-h-72 overflow-auto rounded-lg border border-border-soft">
        <table className="w-full text-left font-mono text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-raised text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Hour</th>
              <th className="px-3 py-2 text-telemetry-grid">Demand kWh</th>
              <th className="px-3 py-2 text-telemetry-solar">Solar kWh</th>
              <th className="px-3 py-2 text-telemetry-battery">Tariff BDT</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {hours.map((h) => (
              <tr
                key={h.hour}
                onClick={() => onSelectHour?.(h.hour)}
                className={
                  "cursor-pointer border-t border-border-soft transition-colors hover:bg-raised " +
                  (selectedHour === h.hour ? "bg-raised" : "")
                }
              >
                <td className="px-3 py-1.5 text-zinc-500">{pad(h.hour)}:00</td>
                <td className="px-3 py-1.5">{h.demand_kwh.toFixed(0)}</td>
                <td className="px-3 py-1.5">{h.solar_kwh.toFixed(1)}</td>
                <td className="px-3 py-1.5">{h.tariff_bdt_per_kwh.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Trace({
  label,
  color,
  values,
  unit,
}: {
  label: string;
  color: string;
  values: number[];
  unit: string;
}) {
  const d = chartPath(values, { width: W, height: H });
  const areaD = closedPath(values, W, H);

  return (
    <div className="rounded-lg border border-border-soft bg-raised p-3">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="text-zinc-400 tabular-nums">
          max {Math.max(...values).toFixed(1)} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
        <path d={areaD} fill={color} fillOpacity={0.18} />
        <path d={d} stroke={color} strokeWidth={1.5} fill="none" />
      </svg>
    </div>
  );
}

function closedPath(values: number[], width: number, height: number): string {
  // Closed area: the chart line + edges down to baseline. The fill
  // color is set on the <path> via fill prop in the caller; we just
  // emit the geometry here.
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  let d = "";
  for (let i = 0; i < values.length; i++) {
    const x = i * stepX;
    const normalized = values.length === 1 ? 0.5 : (values[i]! - min) / range;
    const y = height - normalized * height;
    d += (i === 0 ? `M${round(x)},${round(y)} ` : ` L${round(x)},${round(y)} `);
  }
  d += ` L${round((values.length - 1) * stepX)},${height} L0,${height} Z`;
  return d.trim();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}