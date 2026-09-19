import type { OptimizeOutput } from "@/lib/optimizer/types";
import type { BatteryContext } from "@/lib/llm/directive";
import type { ValidatedDirective } from "@/lib/guardrails/types";

// Final replay validator. Runs AFTER the optimizer returns a plan; rejects
// the plan (or surfaces a violation list) if any PRD §5.5 / §5.7 invariant
// is broken or any active directive is violated. Defense-in-depth: even if
// the optimizer misbehaves, the route never ships a bad plan.
//
// Tolerance: PRD §5.7 says totals must be "exactly recomputable from
// hourly_plan within 0.01 tolerance". We use that same 0.01 budget for
// physics and neutrality, so a single fuzzy-comparison constant covers
// every numeric check. Tight enough to catch real bugs, loose enough to
// absorb HiGHS's 6-decimal rounding dust.

const TOL = 0.01;

export interface PlanValidationArgs {
  hours: { hour: number; demand_kwh: number; solar_kwh: number; tariff_bdt_per_kwh: number }[];
  battery: BatteryContext;
  directives: ValidatedDirective[];
  output: OptimizeOutput;
}

export type ViolationCode =
  | "structure_invalid"
  | "totals_mismatch"
  | "neutrality_violation"
  | "balance_violation"
  | "battery_idle_mismatch"
  | "battery_bounds_violation"
  | "directive_violation";

export interface Violation {
  code: ViolationCode;
  hour?: number;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: Violation[] };

export function validatePlan(args: PlanValidationArgs): ValidationResult {
  const { hours, battery, directives, output } = args;
  const violations: Violation[] = [];

  // 1. Structural: hourly_plan length 24 + ascending by hour.
  if (output.hourly_plan.length !== 24) {
    violations.push({
      code: "structure_invalid",
      message: `hourly_plan must have length 24, got ${output.hourly_plan.length}`,
    });
    // Don't bother with further checks if shape is broken.
    return { ok: false, violations };
  }
  for (let i = 0; i < 24; i++) {
    if (output.hourly_plan[i]!.hour !== i) {
      violations.push({
        code: "structure_invalid",
        hour: i,
        message: `hourly_plan[${i}].hour must be ${i}, got ${output.hourly_plan[i]!.hour}`,
      });
    }
  }
  if (violations.length > 0) return { ok: false, violations };

  // 2. Totals must match hourly_plan (PRD §5.7).
  const recomputed = recomputeTotals(output.hourly_plan, hours.map((h) => h.tariff_bdt_per_kwh));
  if (Math.abs(output.total_grid_kwh - recomputed.total_grid_kwh) > TOL) {
    violations.push({
      code: "totals_mismatch",
      message: `total_grid_kwh mismatch: ${output.total_grid_kwh} vs recomputed ${recomputed.total_grid_kwh}`,
    });
  }
  if (Math.abs(output.total_cost_bdt - recomputed.total_cost_bdt) > TOL) {
    violations.push({
      code: "totals_mismatch",
      message: `total_cost_bdt mismatch: ${output.total_cost_bdt} vs recomputed ${recomputed.total_cost_bdt}`,
    });
  }
  if (Math.abs(output.peak_grid_kwh - recomputed.peak_grid_kwh) > TOL) {
    violations.push({
      code: "totals_mismatch",
      message: `peak_grid_kwh mismatch: ${output.peak_grid_kwh} vs recomputed ${recomputed.peak_grid_kwh}`,
    });
  }

  // 3. Per-hour physics + neutrality + battery bounds + directive replay.
  // Effective solar per hour: raw solar reduced by every stacked
  // solar_reduction directive (factors multiply — same math as the optimizer).
  const effectiveSolar = hours.map((h) => h.solar_kwh);
  for (const d of directives) {
    if (!d.applies || d.directive_type !== "solar_reduction" || !d.structured_adjustment) continue;
    const a = d.structured_adjustment as Extract<typeof d.structured_adjustment, { factor: number }>;
    for (const hour of a.hours) {
      if (hour < 0 || hour > 23) continue;
      effectiveSolar[hour] = effectiveSolar[hour]! * a.factor;
    }
  }

  for (let h = 0; h < 24; h++) {
    const entry = output.hourly_plan[h]!;
    const demand = hours[h]!.demand_kwh;

    // Balance (PRD §5.5 #2): g + s + d - c == demand
    const charge = entry.battery_action === "charge" ? entry.battery_kwh : 0;
    const discharge = entry.battery_action === "discharge" ? entry.battery_kwh : 0;
    const imbalance = entry.grid_kwh + entry.solar_used_kwh + discharge - charge - demand;
    if (Math.abs(imbalance) > TOL) {
      violations.push({
        code: "balance_violation",
        hour: h,
        message: `hour ${h}: g + s + d - c - demand = ${imbalance} (|.| > ${TOL})`,
      });
    }

    // Grid and solar must be non-negative; solar_used must not exceed the
    // effective solar for this hour (PRD §9.4). This covers both base hours
    // and reduction hours — the directive replay below re-checks reductions
    // against the same effective values.
    if (entry.grid_kwh < -TOL) {
      violations.push({
        code: "directive_violation",
        hour: h,
        message: `hour ${h}: grid_kwh=${entry.grid_kwh} < 0`,
      });
    }
    if (entry.solar_used_kwh < -TOL || entry.solar_used_kwh > effectiveSolar[h]! + TOL) {
      violations.push({
        code: "directive_violation",
        hour: h,
        message: `hour ${h}: solar_used=${entry.solar_used_kwh} outside [0, effective=${effectiveSolar[h]}]`,
      });
    }

    // battery_kwh = 0 iff action = idle (PRD §5.7).
    if (entry.battery_action === "idle" && Math.abs(entry.battery_kwh) > TOL) {
      violations.push({
        code: "battery_idle_mismatch",
        hour: h,
        message: `hour ${h}: action=idle but battery_kwh=${entry.battery_kwh}`,
      });
    }
    if (entry.battery_action !== "idle" && Math.abs(entry.battery_kwh) <= TOL) {
      violations.push({
        code: "battery_idle_mismatch",
        hour: h,
        message: `hour ${h}: action=${entry.battery_action} but battery_kwh=0`,
      });
    }

    // Battery energy bounds (PRD §9.2): base minimum <= E_after <= capacity.
    // Active minimum_battery_reserve directives raise the floor further;
    // the directive replay below checks that raised floor.
    if (
      entry.battery_energy_after_kwh < battery.minimum_energy_kwh - TOL ||
      entry.battery_energy_after_kwh > battery.capacity_kwh + TOL
    ) {
      violations.push({
        code: "battery_bounds_violation",
        hour: h,
        message: `hour ${h}: battery_energy_after_kwh=${entry.battery_energy_after_kwh} outside [${battery.minimum_energy_kwh}, ${battery.capacity_kwh}]`,
      });
    }

    // Hourly rate limits (PRD §9.3).
    if (entry.battery_action === "charge" && entry.battery_kwh > battery.max_charge_kwh_per_hour + TOL) {
      violations.push({
        code: "battery_bounds_violation",
        hour: h,
        message: `hour ${h}: charge=${entry.battery_kwh} > max_charge=${battery.max_charge_kwh_per_hour}`,
      });
    }
    if (entry.battery_action === "discharge" && entry.battery_kwh > battery.max_discharge_kwh_per_hour + TOL) {
      violations.push({
        code: "battery_bounds_violation",
        hour: h,
        message: `hour ${h}: discharge=${entry.battery_kwh} > max_discharge=${battery.max_discharge_kwh_per_hour}`,
      });
    }

    // SoC transition (PRD §9.1): E_after[h] = E_before + charge - discharge.
    const eBefore = h === 0 ? battery.initial_energy_kwh : output.hourly_plan[h - 1]!.battery_energy_after_kwh;
    const transition = entry.battery_energy_after_kwh - eBefore - charge + discharge;
    if (Math.abs(transition) > TOL) {
      violations.push({
        code: "battery_bounds_violation",
        hour: h,
        message: `hour ${h}: soc transition drift=${transition} (|.| > ${TOL})`,
      });
    }

    // Neutrality (PRD §5.5 #7): only checked at h=23.
    if (h === 23) {
      if (Math.abs(entry.battery_energy_after_kwh - battery.initial_energy_kwh) > TOL) {
        violations.push({
          code: "neutrality_violation",
          hour: 23,
          message: `soc[23]=${entry.battery_energy_after_kwh} != initial=${battery.initial_energy_kwh}`,
        });
      }
    }
  }

  // 4. Directive replay. Each active directive contributes a constraint;
  // violation codes are aggregated under "directive_violation" with the
  // specific message naming the directive + hour.
  for (const d of directives) {
    if (!d.applies || d.directive_type === "no_op") continue;
    const adj = d.structured_adjustment;
    if (!adj) continue;

    // solar_reduction is already enforced by the per-hour effective-solar
    // check in section 3 (stacked factors multiply, same as the optimizer),
    // so it needs no separate replay branch here.
    if (d.directive_type === "minimum_battery_reserve") {
      const a = adj as Extract<typeof adj, { minimum_energy_kwh: number }>;
      for (const hour of a.hours) {
        if (hour < 0 || hour > 23) continue;
        if (output.hourly_plan[hour]!.battery_energy_after_kwh < a.minimum_energy_kwh - TOL) {
          violations.push({
            code: "directive_violation",
            hour,
            message: `minimum_battery_reserve: h=${hour} soc=${output.hourly_plan[hour]!.battery_energy_after_kwh} < floor=${a.minimum_energy_kwh}`,
          });
        }
      }
    } else if (d.directive_type === "no_charge_window") {
      for (const hour of adj.hours) {
        if (hour < 0 || hour > 23) continue;
        if (output.hourly_plan[hour]!.battery_action === "charge" && output.hourly_plan[hour]!.battery_kwh > TOL) {
          violations.push({
            code: "directive_violation",
            hour,
            message: `no_charge_window: h=${hour} charge=${output.hourly_plan[hour]!.battery_kwh} > 0`,
          });
        }
      }
    } else if (d.directive_type === "no_discharge_window") {
      for (const hour of adj.hours) {
        if (hour < 0 || hour > 23) continue;
        if (output.hourly_plan[hour]!.battery_action === "discharge" && output.hourly_plan[hour]!.battery_kwh > TOL) {
          violations.push({
            code: "directive_violation",
            hour,
            message: `no_discharge_window: h=${hour} discharge=${output.hourly_plan[hour]!.battery_kwh} > 0`,
          });
        }
      }
    } else if (d.directive_type === "max_grid_window") {
      const a = adj as Extract<typeof adj, { max_grid_kwh: number }>;
      for (const hour of a.hours) {
        if (hour < 0 || hour > 23) continue;
        if (output.hourly_plan[hour]!.grid_kwh > a.max_grid_kwh + TOL) {
          violations.push({
            code: "directive_violation",
            hour,
            message: `max_grid_window: h=${hour} grid=${output.hourly_plan[hour]!.grid_kwh} > cap=${a.max_grid_kwh}`,
          });
        }
      }
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// Mirror of the orchestrator's recomputeTotals. Kept here so the validator
// has zero coupling to the orchestrator's internals — it's a separate
// derivation, not a re-export. PRD §5.7 makes this the contract check.
function recomputeTotals(
  plan: OptimizeOutput["hourly_plan"],
  tariffs: number[],
): { total_grid_kwh: number; total_cost_bdt: number; peak_grid_kwh: number } {
  let total_grid_kwh = 0;
  let total_cost_bdt = 0;
  let peak_grid_kwh = 0;
  for (const entry of plan) {
    total_grid_kwh += entry.grid_kwh;
    total_cost_bdt += entry.grid_kwh * tariffs[entry.hour]!;
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
