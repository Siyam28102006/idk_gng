"use client";

// 24-Hour Dispatch Plan — stacked area chart per hour: solar_kwh
// (top, amber), grid_kwh (cyan), with the battery action shown as a
// positive (charge) or negative (discharge) overlay bar. SoC line
// rides on top. Per-hour table at bottom.

export interface DispatchHour {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: "charge" | "discharge" | "idle";
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

export interface DispatchPlanProps {
  hours: DispatchHour[];
  capacityKwh: number;
}

const W = 960;
const H = 220;
const COL_W = W / 24;

export function DispatchPlan({ hours, capacityKwh }: DispatchPlanProps) {
  if (hours.length === 0) return null;

  // Solar fills from baseline upward (amber); grid_kwh stacks on top
  // of solar (cyan). Battery charge/discharge is shown as a separate
  // positive/negative overlay band above the baseline so a charge
  // hour is visually distinct from a discharge hour.
  const solar = hours.map((h) => h.solar_used_kwh);
  const grid = hours.map((h) => h.grid_kwh);

  const maxStack = Math.max(...solar.map((s, i) => s + grid[i]!), 1);

  return (
    <section className="rounded-xl border border-border-soft bg-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-50">24-Hour Dispatch Plan</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          kWh · 60 min interval
        </span>
      </header>

      <div className="mt-4 rounded-lg border border-border-soft bg-raised p-3">
        <Legend />
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
          {/* solar stacked on grid */}
          {hours.map((h, i) => {
            const x = i * COL_W;
            const solarY = H - (solar[i]! / maxStack) * H;
            const gridH = (grid[i]! / maxStack) * H;
            const solarH = (solar[i]! / maxStack) * H;
            return (
              <g key={h.hour}>
                {/* grid (cyan) */}
                <rect
                  x={x + 2}
                  y={solarY - gridH}
                  width={COL_W - 4}
                  height={gridH}
                  fill="#38BDF8"
                  fillOpacity={0.7}
                />
                {/* solar (amber) */}
                <rect
                  x={x + 2}
                  y={H - solarH}
                  width={COL_W - 4}
                  height={solarH}
                  fill="#F59E0B"
                  fillOpacity={0.85}
                />
                {/* battery overlay */}
                <rect
                  x={x + 2}
                  y={h.battery_action === "charge" ? 0 : H / 2 - 4}
                  width={COL_W - 4}
                  height={4}
                  fill={battColor(h.battery_action)}
                  fillOpacity={0.9}
                />
              </g>
            );
          })}

          {/* SoC line — secondary y-axis */}
          <SoCLine hours={hours} capacity={capacityKwh} />
        </svg>

        {/* x-axis hour labels */}
        <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-500 tabular-nums">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>

      <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-border-soft">
        <table className="w-full text-left font-mono text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-raised text-[10px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Hour</th>
              <th className="px-3 py-2 text-telemetry-solar">Solar kWh</th>
              <th className="px-3 py-2 text-telemetry-grid">Grid kWh</th>
              <th className="px-3 py-2 text-telemetry-battery">Battery</th>
              <th className="px-3 py-2 text-telemetry-battery">SoC kWh</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {hours.map((h) => (
              <tr key={h.hour} className="border-t border-border-soft">
                <td className="px-3 py-1.5 text-zinc-500">{pad(h.hour)}:00</td>
                <td className="px-3 py-1.5">{h.solar_used_kwh.toFixed(2)}</td>
                <td className="px-3 py-1.5">{h.grid_kwh.toFixed(2)}</td>
                <td className="px-3 py-1.5">
                  {h.battery_action === "idle"
                    ? "—"
                    : `${h.battery_action.toUpperCase()} ${h.battery_kwh.toFixed(2)}`}
                </td>
                <td className="px-3 py-1.5">{h.battery_energy_after_kwh.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SoCLine({ hours, capacity }: { hours: DispatchHour[]; capacity: number }) {
  if (capacity <= 0 || hours.length === 0) return null;
  const stepX = W / Math.max(1, hours.length - 1);
  const pts = hours
    .map((h, i) => {
      const x = i * stepX;
      const y = H - (h.battery_energy_after_kwh / capacity) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
    })
    .join("");
  return (
    <g>
      <path d={pts.trim()} stroke="#10B981" strokeWidth={1.6} fill="none" />
      {hours.map((h, i) => {
        const x = i * stepX;
        const y = H - (h.battery_energy_after_kwh / capacity) * H;
        return <circle key={h.hour} cx={x} cy={y} r={2} fill="#10B981" />;
      })}
    </g>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
      <span className="flex items-center gap-2">
        <span className="h-2 w-3 rounded-sm bg-telemetry-solar" /> Solar
      </span>
      <span className="flex items-center gap-2">
        <span className="h-2 w-3 rounded-sm bg-telemetry-grid" /> Grid
      </span>
      <span className="flex items-center gap-2">
        <span className="h-2 w-3 rounded-sm bg-telemetry-battery" /> SoC
      </span>
      <span className="flex items-center gap-2">
        <span className="h-2 w-3 rounded-sm bg-emerald-400" /> Charge
      </span>
      <span className="flex items-center gap-2">
        <span className="h-2 w-3 rounded-sm bg-cyan-400" /> Discharge
      </span>
    </div>
  );
}

function battColor(a: "charge" | "discharge" | "idle"): string {
  switch (a) {
    case "charge":
      return "#10B981";
    case "discharge":
      return "#06B6D4";
    case "idle":
      return "#374151";
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}