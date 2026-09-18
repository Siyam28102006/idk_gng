import type { ValidatedDirective } from "@/lib/guardrails/types";
import type { BatteryContext } from "@/lib/llm/directive";

// One hour's worth of input to the optimizer. demand_kwh, solar_kwh,
// tariff_bdt_per_kwh are taken verbatim from the request. effective_solar_kwh
// is the post-reduction value (PRD §5.3: solar_reduction.factor is the fraction
// of solar that REMAINS, so effective = solar * factor for active reductions).
export interface HourInput {
  hour: number; // 0..23, unique, ascending
  demand_kwh: number;
  effective_solar_kwh: number;
  tariff_bdt_per_kwh: number;
}

// Per-hour minimum battery floor (raised by an active minimum_battery_reserve
// directive; otherwise the request's base minimum_energy_kwh).
export interface HourFloor {
  hour: number;
  minimum_energy_kwh: number;
}

// Per-hour charge/discharge caps. base is the request's max_charge/discharge;
// windows force the per-hour cap to 0 when active.
export interface HourChargeCap {
  hour: number;
  max_charge_kwh: number;
  max_discharge_kwh: number;
}

// Per-hour grid cap. base is +infinity; max_grid_window directives cap it
// to the directive's max_grid_kwh for active hours.
export interface HourGridCap {
  hour: number;
  max_grid_kwh: number;
}

// Inputs the optimizer needs. ValidatedDirective list is 1:1 with operator_notes,
// with note_index assigned by position. Battery is the request's parsed battery.
export interface OptimizeInput {
  hours: HourInput[]; // length 24, ascending by hour
  battery: BatteryContext;
  directives: ValidatedDirective[];
}

// One hour of the final dispatch plan.
export interface HourlyEntry {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: "charge" | "discharge" | "idle";
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

// The full plan plus the totals the route returns.
export interface OptimizeOutput {
  hourly_plan: HourlyEntry[]; // length 24, ascending by hour
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
}

// Result of running the LP. failure_reasons is populated only when status
// is "infeasible" or "error" — it carries a typed enum, never the LP's
// internals, so the route can log it generically and never to the client.
export type SolveStatus = "optimal" | "infeasible" | "error";

export type SolverFailureReason =
  | "lp_infeasible"
  | "lp_unbounded"
  | "solver_error"
  | "build_error";

export type SolveResult =
  | { status: "optimal"; output: OptimizeOutput }
  | { status: "infeasible"; failure_reason: SolverFailureReason }
  | { status: "error"; failure_reason: SolverFailureReason; detail: string };