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

function balanced24(demand = 50, solar = 0, initial = 100): {
  hours: { hour: number; demand_kwh: number; solar_kwh: number; tariff_bdt_per_kwh: number }[];
  output: OptimizeOutput;
} {
  // Build a feasible, neutral plan where every hour is fully satisfied by
  // solar + grid, the battery never moves, and the totals are exactly
  // recomputable from the plan. This isolates the validator's contract
  // checks from the optimizer's math.
  const hours = demandOnlyHours().map((h) => ({ ...h, demand_kwh: demand, solar_kwh: solar }));
  const hourly_plan: HourlyEntry[] = [];
  for (let h = 0; h < 24; h++) {
    hourly_plan.push({
      hour: h,
      grid_kwh: Math.max(0, demand - solar),
      solar_used_kwh: Math.min(solar, demand),
      battery_action: "idle",
      battery_kwh: 0,
      battery_energy_after_kwh: initial,
    });
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
    // Update totals consistently so totals_mismatch doesn't fire.
    output.total_grid_kwh = round(output.total_grid_kwh + 0.005);
    output.total_cost_bdt = round(output.total_cost_bdt + 0.005 * hours[5]!.tariff_bdt_per_kwh);
    output.peak_grid_kwh = Math.max(output.peak_grid_kwh, output.hourly_plan[5]!.grid_kwh);
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
    // Force a charge at h=5 with consistent balance.
    output.hourly_plan[5]!.battery_action = "charge";
    output.hourly_plan[5]!.battery_kwh = 10;
    output.hourly_plan[5]!.grid_kwh = output.hourly_plan[5]!.grid_kwh + 10;
    // Adjust totals by +10 grid, +50 cost, and bump peak since 60 > 50.
    output.total_grid_kwh = round(output.total_grid_kwh + 10);
    output.total_cost_bdt = round(output.total_cost_bdt + 10 * 5);
    output.peak_grid_kwh = Math.max(output.peak_grid_kwh, output.hourly_plan[5]!.grid_kwh);
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
    // All hours sit at soc=initial=100. Reserve floor=150 → all violate.
    const directives = [vd("minimum_battery_reserve", { hours: [5], minimum_energy_kwh: 150 })];
    const result = validatePlan({ hours, battery: battery({ initial_energy_kwh: 100 }), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("no_charge_window violated (charge > 0 at active hour) → reject", () => {
    // Force a charge at h=5 to make the test independent of any other
    // battery activity in balanced24.
    const { hours, output } = balanced24();
    output.hourly_plan[5]!.battery_action = "charge";
    output.hourly_plan[5]!.battery_kwh = 10;
    // Now balance requires grid + solar + discharge - charge = demand.
    // grid -= 10 to keep balance.
    output.hourly_plan[5]!.grid_kwh = Math.max(0, output.hourly_plan[5]!.grid_kwh - 10);
    const directives = [vd("no_charge_window", { hours: [5] })];
    const result = validatePlan({ hours, battery: battery(), directives, output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });

  test("no_discharge_window violated (discharge > 0 at active hour) → reject", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[5]!.battery_action = "discharge";
    output.hourly_plan[5]!.battery_kwh = 10;
    // Balance: grid + solar + discharge - charge = demand, so grid += 10.
    output.hourly_plan[5]!.grid_kwh = output.hourly_plan[5]!.grid_kwh + 10;
    const directives = [vd("no_discharge_window", { hours: [5] })];
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
    // Restore balance: g + s + d - c = demand → 50 + 2.4 - 2.4 = 50. Wait,
    // the existing grid was already 50 and solar_used was 0; with new solar=2.4
    // we need grid=50-2.4=47.6 to keep balance.
    output.hourly_plan[5]!.grid_kwh = 50 - 2.4;
    output.total_grid_kwh = round(output.total_grid_kwh - 2.4);
    output.total_cost_bdt = round(output.total_cost_bdt - 2.4 * hours[5]!.tariff_bdt_per_kwh);
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

describe("validatePlan — base minimum reserve (PRD §9.2)", () => {
  test("battery_energy_after_kwh below base minimum_energy_kwh → reject", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[10]!.battery_energy_after_kwh = 10;
    const result = validatePlan({
      hours,
      battery: battery({ minimum_energy_kwh: 40 }),
      directives: [],
      output,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "battery_bounds_violation")).toBe(true);
  });
});

describe("validatePlan — hourly rate limits (PRD §9.3)", () => {
  function ratePairPlan(): {
    hours: { hour: number; demand_kwh: number; solar_kwh: number; tariff_bdt_per_kwh: number }[];
    output: OptimizeOutput;
  } {
    // Demand 100, no solar. h2 charges 60 (> 50 cap), h3 discharges 60
    // (> 50 cap) so SoC transitions and neutrality stay consistent and only
    // the rate checks fire.
    const { hours } = balanced24(100, 0, 100);
    const hourly_plan: HourlyEntry[] = [];
    for (let h = 0; h < 24; h++) {
      hourly_plan.push({
        hour: h,
        grid_kwh: 100,
        solar_used_kwh: 0,
        battery_action: "idle",
        battery_kwh: 0,
        battery_energy_after_kwh: 100,
      });
    }
    hourly_plan[2] = { hour: 2, grid_kwh: 160, solar_used_kwh: 0, battery_action: "charge", battery_kwh: 60, battery_energy_after_kwh: 160 };
    hourly_plan[3] = { hour: 3, grid_kwh: 40, solar_used_kwh: 0, battery_action: "discharge", battery_kwh: 60, battery_energy_after_kwh: 100 };
    let total_grid = 0;
    let total_cost = 0;
    let peak = 0;
    for (const e of hourly_plan) {
      total_grid += e.grid_kwh;
      total_cost += e.grid_kwh * hours[e.hour]!.tariff_bdt_per_kwh;
      peak = Math.max(peak, e.grid_kwh);
    }
    return {
      hours,
      output: { hourly_plan, total_grid_kwh: round(total_grid), total_cost_bdt: round(total_cost), peak_grid_kwh: round(peak) },
    };
  }

  test("charge above max_charge_kwh_per_hour → reject", () => {
    const { hours, output } = ratePairPlan();
    const result = validatePlan({
      hours,
      battery: battery({ max_charge_kwh_per_hour: 50, max_discharge_kwh_per_hour: 60 }),
      directives: [],
      output,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "battery_bounds_violation" && v.message.includes("charge"))).toBe(true);
  });

  test("discharge above max_discharge_kwh_per_hour → reject", () => {
    const { hours, output } = ratePairPlan();
    const result = validatePlan({
      hours,
      battery: battery({ max_charge_kwh_per_hour: 60, max_discharge_kwh_per_hour: 50 }),
      directives: [],
      output,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "battery_bounds_violation" && v.message.includes("discharge"))).toBe(true);
  });
});

describe("validatePlan — base solar cap (PRD §9.4)", () => {
  test("solar_used_kwh above available solar_kwh → reject", () => {
    const { hours, output } = balanced24(100, 50, 100);
    output.hourly_plan[5] = { ...output.hourly_plan[5]!, solar_used_kwh: 60, grid_kwh: 40 };
    let total_grid = 0;
    let total_cost = 0;
    let peak = 0;
    for (const e of output.hourly_plan) {
      total_grid += e.grid_kwh;
      total_cost += e.grid_kwh * hours[e.hour]!.tariff_bdt_per_kwh;
      peak = Math.max(peak, e.grid_kwh);
    }
    output.total_grid_kwh = round(total_grid);
    output.total_cost_bdt = round(total_cost);
    output.peak_grid_kwh = round(peak);
    const result = validatePlan({ hours, battery: battery(), directives: [], output });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((v) => v.code === "directive_violation")).toBe(true);
  });
});

describe("validatePlan — SoC transitions (PRD §9.1)", () => {
  test("battery_energy_after jump without charge/discharge → reject", () => {
    const { hours, output } = balanced24();
    output.hourly_plan[6]!.battery_energy_after_kwh = 150;
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
