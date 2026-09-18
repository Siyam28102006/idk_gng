// Pure helpers that power the local UI harness. Keeping them separate
// from JSX means we can unit-test the math (curve shapes, path
// generation, totals) without React.

export interface HourRow {
  hour: number;
  demand_kwh: number;
  solar_kwh: number;
  tariff_bdt_per_kwh: number;
}

// SAMPLE-style evening peak: demand ramps from ~30 kWh overnight to
// ~140 kWh at 17–21, back down to ~40 kWh. Tied to the campus profile
// shown in the design.
export function sampleDemand(): HourRow[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    demand_kwh:
      h >= 17 && h <= 21
        ? 100 + (h - 17) * 6
        : h >= 8 && h <= 16
          ? 45 + (h - 8) * 1
          : 35,
    solar_kwh: 0,
    tariff_bdt_per_kwh: 0,
  }));
}

// Daylight curve: zero before 6am and after 18pm, peak at noon.
// `sin(π·h/12)` lands on ≈9.8e-15 right at h=6 and h=18 due to
// floating-point error; clamp near-zero to true zero so the UI and
// the Equality-strict tests agree.
export function sampleSolar(): HourRow[] {
  const raw = Array.from({ length: 24 }, (_, h) =>
    h >= 6 && h <= 18 ? Math.max(0, Math.sin(((h - 6) / 12) * Math.PI) * 80) : 0,
  );
  return raw.map((v, h) => ({
    hour: h,
    demand_kwh: 0,
    solar_kwh: v < 1e-6 ? 0 : v,
    tariff_bdt_per_kwh: 0,
  }));
}

// Tariff: BDT 5 off-peak, 12 evening peak.
export function sampleTariff(): HourRow[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    demand_kwh: 0,
    solar_kwh: 0,
    tariff_bdt_per_kwh: h >= 17 && h <= 21 ? 12 : 5,
  }));
}

// Returns a "combined" 24h envelope ready to send to the API.
export function sampleEnvelope(battery?: {
  capacity_kwh?: number;
  initial_energy_kwh?: number;
  minimum_energy_kwh?: number;
  max_charge_kwh_per_hour?: number;
  max_discharge_kwh_per_hour?: number;
}): {
  scenario_id: string;
  operator_notes: string[];
  hours: HourRow[];
  battery: {
    capacity_kwh: number;
    initial_energy_kwh: number;
    minimum_energy_kwh: number;
    max_charge_kwh_per_hour: number;
    max_discharge_kwh_per_hour: number;
  };
} {
  const demand = sampleDemand();
  const solar = sampleSolar();
  const tariff = sampleTariff();
  const hours: HourRow[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    demand_kwh: demand[h]!.demand_kwh,
    solar_kwh: solar[h]!.solar_kwh,
    tariff_bdt_per_kwh: tariff[h]!.tariff_bdt_per_kwh,
  }));
  return {
    scenario_id: "scenario-campus-2026-0314",
    operator_notes: [
      "PV production will drop by 80% between 13:00 and 15:00 due to rooftop panel washing maintenance.",
      "Keep battery reserve at minimum 50 kWh between 17:00 and 21:00 for evening campus auditorium event.",
    ],
    hours,
    battery: {
      capacity_kwh: battery?.capacity_kwh ?? 120,
      initial_energy_kwh: battery?.initial_energy_kwh ?? 45,
      minimum_energy_kwh: battery?.minimum_energy_kwh ?? 15,
      max_charge_kwh_per_hour: battery?.max_charge_kwh_per_hour ?? 30,
      max_discharge_kwh_per_hour: battery?.max_discharge_kwh_per_hour ?? 35,
    },
  };
}

// Convert an array of numeric values into an SVG path string. The
// path's y is inverted (SVG origin is top-left). The output starts
// with "M" and "L" segments are space-joined. Returns an empty string
// when the input is empty. Single-point series render at the vertical
// midpoint so a one-value chart is visible.
export function chartPath(values: number[], opts: { width: number; height: number }): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? opts.width / (values.length - 1) : 0;
  const points: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = i * stepX;
    // Single-point series (or constant series): place at vertical
    // midpoint so the chart is visible.
    const normalized = values.length === 1 ? 0.5 : (values[i]! - min) / range;
    const y = opts.height - normalized * opts.height;
    points.push(i === 0 ? `M${round(x)},${round(y)}` : `L${round(x)},${round(y)}`);
  }
  // Single-point series has no trailing L; append a trailing space so
  // single-point callers don't need to special-case it.
  return points.join(" ") + (values.length === 1 ? " " : "");
}

// Compact sparkline variant — same shape as chartPath. Single-point
// series are centered so they're visible.
export function sparkPath(values: number[], opts: { width: number; height: number }): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? opts.width / (values.length - 1) : 0;
  const points: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = i * stepX;
    const normalized = values.length === 1 ? 0.5 : (values[i]! - min) / range;
    const y = opts.height - normalized * opts.height;
    points.push(i === 0 ? `M${round(x)},${round(y)}` : `L${round(x)},${round(y)}`);
  }
  return points.join(" ") + (values.length === 1 ? " " : "");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// UI-layer color resolver. Kept tiny — used by both the timeline and
// the directive interpretation cards. Colors pinned to DESIGN.md
// telemetry tokens (battery = emerald #10B981, discharge = cyan
// #38BDF8, idle = slate #64748B).
export type BatteryAction = "charge" | "discharge" | "idle";

export function batteryActionColor(action: BatteryAction): string {
  switch (action) {
    case "charge":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/40";
    case "discharge":
      return "text-cyan-400 bg-cyan-400/10 border-cyan-400/40";
    case "idle":
    default:
      return "text-slate-400 bg-slate-500/10 border-slate-500/40";
  }
}

export type DirectiveKind =
  | "solar_reduction"
  | "minimum_battery_reserve"
  | "no_charge_window"
  | "no_discharge_window"
  | "max_grid_window"
  | "no_op";

// Tailwind classes for the directive status badge — colors pinned to
// the DESIGN.md tokens (Solar amber / Reserve emerald / no_charge
// violet / no_discharge rose / max_grid cyan / no_op slate).
export function directiveBadgeClass(kind: DirectiveKind): string {
  switch (kind) {
    case "solar_reduction":
      return "border-amber-500/40 bg-amber-500/10 text-amber-400";
    case "minimum_battery_reserve":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "no_charge_window":
      return "border-violet-500/40 bg-violet-500/10 text-violet-400";
    case "no_discharge_window":
      return "border-rose-500/40 bg-rose-500/10 text-rose-400";
    case "max_grid_window":
      return "border-cyan-500/40 bg-cyan-500/10 text-cyan-400";
    case "no_op":
    default:
      // DESIGN.md pins no_op to slate (#64748B) per the directive badge
      // table — "no_op" is an explicitly recognized state, not a fallback.
      return "border-slate-500/40 bg-slate-500/10 text-slate-400";
  }
}

// Mirror of the validator's recomputeTotals, kept here so the UI can
// derive totals from the response without re-implementing the math.
export function recomputeTotals(
  plan: { hour: number; grid_kwh: number }[],
  tariffs: number[],
): { total_grid_kwh: number; total_cost_bdt: number; peak_grid_kwh: number } {
  let total_grid_kwh = 0;
  let total_cost_bdt = 0;
  let peak_grid_kwh = 0;
  for (const e of plan) {
    total_grid_kwh += e.grid_kwh;
    total_cost_bdt += e.grid_kwh * tariffs[e.hour]!;
    peak_grid_kwh = Math.max(peak_grid_kwh, e.grid_kwh);
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    total_grid_kwh: round(total_grid_kwh),
    total_cost_bdt: round(total_cost_bdt),
    peak_grid_kwh: round(peak_grid_kwh),
  };
}
