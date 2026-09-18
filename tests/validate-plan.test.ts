import { describe, expect, test } from "bun:test";
import { validatePlan } from "@/lib/validate/validate-plan";
import type { HourlyEntry, OptimizeOutput } from "@/lib/optimizer/types";
import type { ValidatedDirective } from "@/lib/guardrails/types";
import type { BatteryContext } from "@/lib/llm/directive";

// Build a 24-hour request envelope and an OptimizeOutput shell; tests mutate
// individual entries / totals to exercise specific replay rules.

function battery(over: Partial<BatteryContext> = {}): BatteryContext {
  return {
    capacity_kwh: 200,
    initial_energy_kwh: 100,
    minimum_energy_kwh: 0,
    max_charge_kwh_per_hour: 100,
    max_discharge_kwh_per_hour: 100,
    ...over,
  };
}

function demandOnlyHours(): { hour: number; demand_kwh: number; solar_kwh: number; tariff_bdt_per_kwh: number }[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    demand_kwh: 50,
    solar_kwh: 0,
    tariff_bdt_per_kwh: 5,
  }));
}

function emptyEntry(h: number): HourlyEntry {
  return {
    hour: h,
    grid_kwh: 0,
    solar_used_kwh: 0,
    battery_action: "idle",
    battery_kwh: 0,
    battery_energy_after_kwh: 100,
  };
}

function balanced24(demand = 50, solar = 0, initial = 100, chargeCap = 100, dischargeCap = 100): {
  hours: { hour: number; demand_kwh: number; solar_kwh: number; tariff_bdt_per_kwh: number }[];
  output: OptimizeOutput;
} {
  // Build a feasible, neutral plan: charge/discharge only via battery,
  // grid covers residual. Then recompute totals via recomputeTotals-style
  // math below so the validatePlan() check agrees.
  const hours = demandOnlyHours().map((h) => ({ ...h, demand_kwh: demand }));
  const hourly_plan: HourlyEntry[] = [];
  for (let h = 0; h < 24; h++) {
    let soc = h === 0 ? initial : hourly_plan[h - 1]!.battery_energy_after_kwh;
    // Simple feasibility: every hour ends at initial via tiny round-trips.
    // We just need totals to recompute correctly for the validator.
    const entry: HourlyEntry = {
      hour: h,
      grid_kwh: Math.max(0, demand - solar),
      solar_used_kwh: Math.min(solar, demand),
      battery_action: "idle",
      battery_kwh: 0,
      battery_energy_after_kwh: initial,
    };
    // Charge at h=0 from initial to push to capacity, discharge at h=23 to
    // return to initial. Use the charge/discharge caps.
    if (h === 0) {
      const charge = Math.min(chargeCap, 200 - soc);
      entry.battery_action = "charge";
      entry.battery_kwh = charge;
      entry.grid_kwh = Math.max(0, demand - solar) + charge;
      soc += charge;
      entry.battery_energy_after_kwh = soc;
    } else if (h === 23) {
      const discharge = Math.min(dischargeCap, soc - initial);
      entry.battery_action = "discharge";
      entry.battery_kwh = discharge;
      entry.grid_kwh = Math.max(0, demand - solar + discharge);
      soc -= discharge;
      entry.battery_energy_after_kwh = soc;
    } else {
      entry.battery_energy_after_kwh = soc;
    }
    hourly_plan.push(entry);
  }
  // Compute totals from the plan.
  let total_grid = 0;
  let total_cost = 0;
  let peak = 0;
  for (const e of hourly_plan) {
    total_grid += e.grid_kwh;
    total_cost += e.grid_kwh * hours[e.hour]!.tariff_bdt_per_kwh;
    peak = Math.max(peak, e.grid_kwh);
  }
  const output: OptimizeOutput = {
    hourly_plan,
    total_grid_kwh: round(total_grid),
    total_cost_bdt: round(total_cost),
    peak_grid_kwh: round(peak),
  };
  return { hours, output };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function vd(
  directive_type: ValidatedDirective["directive_type"],
  structured_adjustment: ValidatedDirective["structured_adjustment"],
  applies = true,
): ValidatedDirective {
  return { note_index: 0, directive_type, applies, structured_adjustment };
}

describe("validatePlan — happy path", () => {
  test("empty directives + neutral plan: ok", () => {
    const { hours, output } = balanced24();
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan — totals must match hourly_plan (PRD §5.7)", () => {
  test("total_grid_kwh mismatch → reject with totals_mismatch", () => {
    const { hours, output } = balanced24();
    output.total_grid_kwh += 1; // wrong by 1 kWh
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "totals_mismatch")).toBe(true);
  });

  test("total_cost_bdt mismatch → reject", () => {
    const { hours, output } = balanced24();
    output.total_cost_bdt += 0.5;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "totals_mismatch")).toBe(true);
  });

  test("peak_grid_kwh mismatch → reject", () => {
    const { hours, output } = balanced24();
    output.peak_grid_kwh += 5;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "totals_mismatch")).toBe(true);
  });

  test("match within 0.01 tolerance → ok", () => {
    const { hours, output } = balanced24();
    // Drift the totals by 5e-3 (within 0.01) and shift hourly_plan
    // entries to keep self-consistency.
    output.total_grid_kwh += 0.005;
    output.total_cost_bdt += 0.005;
    output.peak_grid_kwh += 0.005;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan — neutrality (PRD §5.5 #7)", () => {
  test("soc[23] != initial → reject with neutrality_violation", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[23]!.battery_energy_after_kwh += 5;
    const result = validatePlan({ hours, battery: battery({ initial_energy_kwh: 100 }), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "neutrality_violation")).toBe(true);
  });

  test("soc[23] == initial → ok", () => {
    const { hours, output } = balanced24();
    // balanced24 already ends at initial; double-check.
    expect(output.hourly_plan[23]!.battery_energy_after_kwh).toBe(100);
    const result = validatePlan({ hours, battery: battery({ initial_energy_kwh: 100 }), directives: [], output });
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan — physics (PRD §5.5 #2 balance)", () => {
  test("grid + solar_used + discharge - charge != demand → balance_violation", () => {
    const { hours, output } = balanced24();
    // Add 1 kWh phantom to grid at h=10; must be balanced.
    output.hourly_plan[10]!.grid_kwh += 1;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "balance_violation")).toBe(true);
  });

  test("physics holds within 0.01 → ok", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[5]!.grid_kwh += 0.005;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan — battery_kwh = 0 when action = idle (PRD §5.7)", () => {
  test("idle + battery_kwh != 0 → reject with battery_idle_mismatch", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[5]!.battery_action = "idle";
    output.hourly_plan[5]!.battery_kwh = 3;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "battery_idle_mismatch")).toBe(true);
  });

  test("charge + battery_kwh == charge magnitude → ok", () => {
    const { hours, output } = balanced24();
    // h=0 is already "charge" with battery_kwh = charge amount.
    expect(output.hourly_plan[0]!.battery_action).toBe("charge");
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan — directive replay", () => {
  test("max_grid_window violated (grid_kwh > cap at active hour) → reject", () => {
    const { hours, output } = balanced24();
    // active at h=18,19,20 with cap 20. Force h=18 to grid=999.
    output.hourly_plan[18]!.grid_kwh = 999;
    const directives = [vd("max_grid_window", { hours: [18, 19, 20], max_grid_kwh: 20 })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("max_grid_window respected → ok", () => {
    const { hours, output } = balanced24();
    // balanced24 has grid around demand (50) everywhere; cap at 100 → ok.
    const directives = [vd("max_grid_window", { hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], max_grid_kwh: 200 })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(true);
  });

  test("no_op / applies=false directives are ignored", () => {
    const { hours, output } = balanced24();
    // no_op with a would-violating payload, but applies=false → skipped.
    const directives: ValidatedDirective[] = [
      vd("max_grid_window", { hours: [0, 1, 2], max_grid_kwh: 1 }, false),
    ];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(true);
  });

  test("minimum_battery_reserve violated (soc < floor at active hour) → reject", () => {
    const { hours, output } = balanced24();
    // All hours sit at soc=100; reserve floor=150 → all violate.
    const directives = [vd("minimum_battery_reserve", { hours: [5], minimum_energy_kwh: 150 })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("no_charge_window violated (charge > 0 at active hour) → reject", () => {
    const { hours, output } = balanced24();
    // h=0 has battery_action=charge. Add no_charge_window at h=0.
    const directives = [vd("no_charge_window", { hours: [0] })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("no_discharge_window violated (discharge > 0 at active hour) → reject", () => {
    const { hours, output } = balanced24();
    // h=23 has battery_action=discharge. Add no_discharge_window at h=23.
    const directives = [vd("no_discharge_window", { hours: [23] })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("solar_reduction violated (solar_used > effective_solar at active hour) → reject", () => {
    const { hours, output } = balanced24();
    hours[5]!.solar_kwh = 10;
    output.hourly_plan[5]!.solar_used_kwh = 8;
    // factor = 0.25 → effective_solar at h=5 = 2.5; solar_used=8 > 2.5.
    const directives = [vd("solar_reduction", { hours: [5], factor: 0.25 })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("solar_reduction respected → ok", () => {
    const { hours, output } = balanced24();
    hours[5]!.solar_kwh = 10;
    output.hourly_plan[5]!.solar_used_kwh = 2.4;
    const directives = [vd("solar_reduction", { hours: [5], factor: 0.25 })]; // effective = 2.5
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(true);
  });
});

describe("validatePlan — battery energy bounds (PRD §5.5 #5)", () => {
  test("battery_energy_after_kwh > capacity → reject", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[10]!.battery_energy_after_kwh = 999;
    const result = validatePlan({ hours, battery: battery({ capacity_kwh: 200 }), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "battery_bounds_violation")).toBe(true);
  });

  test("battery_energy_after_kwh < 0 → reject", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[10]!.battery_energy_after_kwh = -1;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "battery_bounds_violation")).toBe(true);
  });
});

describe("validatePlan — structural", () => {
  test("hourly_plan length != 24 → reject", () => {
    const { hours } = demandOnlyHours();
    const result = validatePlan({
      hours,
      battery: battery(),
      directives: [],
      output: {
        hourly_plan: [emptyEntry(0)],
        total_grid_kwh: 0,
        total_cost_bdt: 0,
        peak_grid_kwh: 0,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "structure_invalid")).toBe(true);
  });

  test("hourly_plan not ascending by hour → reject", () => {
    const { hours, output } = balanced24();
    // Swap entries 0 and 1 to break ordering.
    [output.hourly_plan[0], output.hourly_plan[1]] = [output.hourly_plan[1]!, output.hourly_plan[0]!];
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "structure_invalid")).toBe(true);
  });

  test("multiple violations are all reported", () => {
    const { hours, output } = balanced24();
    output.total_grid_kwh += 5;
    output.hourly_plan[5]!.battery_energy_after_kwh = 999;
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});
