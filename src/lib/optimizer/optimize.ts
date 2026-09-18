import type {
  HourChargeCap,
  HourFloor,
  HourGridCap,
  HourInput,
  OptimizeInput,
  OptimizeOutput,
  SolveResult,
} from "./types";
import { buildLpText } from "./build-lp";
import { solveLp } from "./solve";

// Orchestrator: takes the validated inputs, applies the directive constraints
// (PRD §5.5 #5, #6; e04s02 layers this), builds the LP (e04s01), solves
// (e04s01), returns the dispatch plan.
//
// This is the single public entry point the route calls. It hides the
// directive-to-override mapping, the LP construction, and the solver adapter.
// Tests cover each piece separately (build-lp, solve) plus an integration
// test here for the end-to-end shape.

// Apply validated directives to produce per-hour overrides. This is e04s02's
// substance: stack multiple active directives correctly so the LP carries the
// combined constraint set.
//
// We use an if/else-if chain (not switch) so TypeScript narrows `adj` per
// branch — switch on `d.directive_type` doesn't propagate the narrowing
// through to `d.structured_adjustment`. The chain is verbose but the audit
// can name every directive's effect on every per-hour override.
export function applyDirectives(input: OptimizeInput): {
  hours: HourInput[];
  floors: HourFloor[];
  charge_caps: HourChargeCap[];
  grid_caps: HourGridCap[];
} {
  // Sort hours ascending by hour field (defensive; route guarantees it, but
  // the LP builder re-validates and rejects otherwise).
  const sortedHours = [...input.hours].sort((a, b) => a.hour - b.hour);
  if (sortedHours.length !== 24) {
    throw new Error("apply_directives: expected 24 hours");
  }

  // Per-hour overrides initialized to the request's base values.
  const floors: HourFloor[] = sortedHours.map((h) => ({
    hour: h.hour,
    minimum_energy_kwh: input.battery.minimum_energy_kwh,
  }));
  const charge_caps: HourChargeCap[] = sortedHours.map((h) => ({
    hour: h.hour,
    max_charge_kwh: input.battery.max_charge_kwh_per_hour,
    max_discharge_kwh: input.battery.max_discharge_kwh_per_hour,
  }));
  const grid_caps: HourGridCap[] = sortedHours.map((h) => ({
    hour: h.hour,
    max_grid_kwh: Number.POSITIVE_INFINITY,
  }));
  const hours: HourInput[] = sortedHours.map((h) => ({ ...h }));

  for (const d of input.directives) {
    if (!d.applies || d.directive_type === "no_op") continue;
    const adj = d.structured_adjustment;
    if (!adj) continue; // applies=true with null adjustment is impossible after the guardrail; defensive.

    if (d.directive_type === "solar_reduction") {
      // factor is the fraction that REMAINS (PRD §5.3).
      const a = adj as Extract<typeof adj, { factor: number }>;
      for (const hour of a.hours) {
        if (hour < 0 || hour > 23) continue;
        hours[hour].effective_solar_kwh = hours[hour].effective_solar_kwh * a.factor;
      }
    } else if (d.directive_type === "minimum_battery_reserve") {
      const a = adj as Extract<typeof adj, { minimum_energy_kwh: number }>;
      for (const hour of a.hours) {
        if (hour < 0 || hour > 23) continue;
        floors[hour].minimum_energy_kwh = Math.max(
          floors[hour].minimum_energy_kwh,
          a.minimum_energy_kwh,
        );
      }
    } else if (d.directive_type === "no_charge_window") {
      for (const hour of adj.hours) {
        if (hour < 0 || hour > 23) continue;
        charge_caps[hour].max_charge_kwh = 0;
      }
    } else if (d.directive_type === "no_discharge_window") {
      for (const hour of adj.hours) {
        if (hour < 0 || hour > 23) continue;
        charge_caps[hour].max_discharge_kwh = 0;
      }
    } else if (d.directive_type === "max_grid_window") {
      const a = adj as Extract<typeof adj, { max_grid_kwh: number }>;
      for (const hour of a.hours) {
        if (hour < 0 || hour > 23) continue;
        grid_caps[hour].max_grid_kwh = Math.min(
          grid_caps[hour].max_grid_kwh,
          a.max_grid_kwh,
        );
      }
    }
  }

  return { hours, floors, charge_caps, grid_caps };
}

// End-to-end: apply directives → build LP → solve → recompute totals.
export async function optimize(input: OptimizeInput): Promise<SolveResult> {
  const { hours, floors, charge_caps, grid_caps } = applyDirectives(input);
  const lpText = buildLpText({
    hours,
    capacity_kwh: input.battery.capacity_kwh,
    initial_energy_kwh: input.battery.initial_energy_kwh,
    floors,
    charge_caps,
    grid_caps,
  });
  const result = await solveLp(lpText);
  if (result.status !== "optimal") return result;
  // Recompute totals from hourly_plan + tariff. PRD §5.7 contract: the three
  // totals must be exactly recomputable from hourly_plan within 0.01
  // tolerance. We compute them here so the route and the final validator
  // see a single source of truth.
  const tariffs = hours.map((h) => h.tariff_bdt_per_kwh);
  const totals = recomputeTotals(result.output, tariffs);
  return {
    status: "optimal",
    output: {
      hourly_plan: result.output.hourly_plan,
      ...totals,
    },
  };
}

// Recompute the three response-level totals from the produced plan and the
// request's tariff array. This is the §5.7 contract: totals must be exactly
// recomputable from hourly_plan within tolerance.
export function recomputeTotals(
  output: OptimizeOutput,
  tariffs: number[],
): { total_grid_kwh: number; total_cost_bdt: number; peak_grid_kwh: number } {
  let total_grid_kwh = 0;
  let total_cost_bdt = 0;
  let peak_grid_kwh = 0;
  for (const entry of output.hourly_plan) {
    total_grid_kwh += entry.grid_kwh;
    total_cost_bdt += entry.grid_kwh * tariffs[entry.hour];
    peak_grid_kwh = Math.max(peak_grid_kwh, entry.grid_kwh);
  }
  return {
    total_grid_kwh: round(total_grid_kwh),
    total_cost_bdt: round(total_cost_bdt),
    peak_grid_kwh: round(peak_grid_kwh),
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
