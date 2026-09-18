import { describe, expect, test } from "bun:test";
import { applyDirectives, optimize, recomputeTotals } from "@/lib/optimizer/optimize";
import type { OptimizeInput, OptimizeOutput } from "@/lib/optimizer/types";
import type { ValidatedDirective } from "@/lib/guardrails/types";
import type { BatteryContext } from "@/lib/llm/directive";

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
  // 24 hours, all demand 50 kWh, no solar, uniform tariff 5 BDT/kWh.
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    demand_kwh: 50,
    solar_kwh: 0,
    tariff_bdt_per_kwh: 5,
  }));
}

function tariffs(): number[] {
  return Array(24).fill(5);
}

// Build a ValidatedDirective of any type. `applies` defaults to true except for no_op.
function vd(
  directive_type: ValidatedDirective["directive_type"],
  structured_adjustment: ValidatedDirective["structured_adjustment"],
  applies = true,
): ValidatedDirective {
  return { note_index: 0, directive_type, applies, structured_adjustment };
}

describe("applyDirectives (e04s02)", () => {
  test("no_op and applies=false are skipped (no overrides change)", () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [
        vd("no_op", null, false),
        vd("solar_reduction", { hours: [5], factor: 0.5 }, false), // applies=false → skipped
      ],
    };
    const out = applyDirectives(input);
    expect(out.floors.every((f) => f.minimum_energy_kwh === 0)).toBe(true);
    expect(out.hours[5].effective_solar_kwh).toBe(0); // unchanged from input
    expect(out.charge_caps.every((c) => c.max_charge_kwh === 100)).toBe(true);
    expect(out.grid_caps.every((g) => Number.isFinite(g.max_grid_kwh))).toBe(false); // all +inf
  });

  test("solar_reduction multiplies effective_solar_kwh by factor", () => {
    const hours = demandOnlyHours();
    hours[10].solar_kwh = 20;
    const input: OptimizeInput = {
      hours: hours.map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [vd("solar_reduction", { hours: [10, 11, 12], factor: 0.2 })],
    };
    const out = applyDirectives(input);
    expect(out.hours[10].effective_solar_kwh).toBeCloseTo(4, 9);
    expect(out.hours[11].effective_solar_kwh).toBeCloseTo(0, 9);
    expect(out.hours[12].effective_solar_kwh).toBeCloseTo(0, 9);
  });

  test("minimum_battery_reserve raises the per-hour floor", () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery({ minimum_energy_kwh: 10 }),
      directives: [vd("minimum_battery_reserve", { hours: [18, 19, 20], minimum_energy_kwh: 90 })],
    };
    const out = applyDirectives(input);
    expect(out.floors[18].minimum_energy_kwh).toBe(90);
    expect(out.floors[19].minimum_energy_kwh).toBe(90);
    expect(out.floors[20].minimum_energy_kwh).toBe(90);
    expect(out.floors[0].minimum_energy_kwh).toBe(10); // base unchanged elsewhere
  });

  test("no_charge_window / no_discharge_window force the relevant cap to 0", () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [
        vd("no_charge_window", { hours: [2, 3, 4] }),
        vd("no_discharge_window", { hours: [18, 19] }),
      ],
    };
    const out = applyDirectives(input);
    expect(out.charge_caps[2].max_charge_kwh).toBe(0);
    expect(out.charge_caps[3].max_charge_kwh).toBe(0);
    expect(out.charge_caps[4].max_charge_kwh).toBe(0);
    expect(out.charge_caps[0].max_charge_kwh).toBe(100); // unchanged
    expect(out.charge_caps[18].max_discharge_kwh).toBe(0);
    expect(out.charge_caps[19].max_discharge_kwh).toBe(0);
    expect(out.charge_caps[18].max_charge_kwh).toBe(100); // charge cap independent
  });

  test("max_grid_window caps grid_kwh at the directive value", () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [vd("max_grid_window", { hours: [18, 19, 20], max_grid_kwh: 155 })],
    };
    const out = applyDirectives(input);
    expect(out.grid_caps[18].max_grid_kwh).toBe(155);
    expect(out.grid_caps[19].max_grid_kwh).toBe(155);
    expect(out.grid_caps[20].max_grid_kwh).toBe(155);
    expect(Number.isFinite(out.grid_caps[0].max_grid_kwh)).toBe(false);
  });

  test("stacked directives layer correctly (SAMPLE-07 pattern: reserve + grid cap)", () => {
    // SAMPLE-07: reserve [18,19,20,21] 90 kWh + max_grid [19,20] <= 180.
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [
        vd("minimum_battery_reserve", { hours: [18, 19, 20, 21], minimum_energy_kwh: 90 }),
        vd("max_grid_window", { hours: [19, 20], max_grid_kwh: 180 }),
      ],
    };
    const out = applyDirectives(input);
    // Reserve applied at all four hours.
    for (const h of [18, 19, 20, 21]) {
      expect(out.floors[h].minimum_energy_kwh).toBe(90);
    }
    // Grid cap only at h=19,20.
    expect(out.grid_caps[19].max_grid_kwh).toBe(180);
    expect(out.grid_caps[20].max_grid_kwh).toBe(180);
    // h=18,21 are reserved but uncapped.
    expect(Number.isFinite(out.grid_caps[18].max_grid_kwh)).toBe(false);
    expect(Number.isFinite(out.grid_caps[21].max_grid_kwh)).toBe(false);
  });

  test("multiple max_grid_window directives: tightest wins", () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [
        vd("max_grid_window", { hours: [10, 11, 12], max_grid_kwh: 100 }),
        vd("max_grid_window", { hours: [11, 12, 13], max_grid_kwh: 50 }),
      ],
    };
    const out = applyDirectives(input);
    expect(out.grid_caps[10].max_grid_kwh).toBe(100);
    expect(out.grid_caps[11].max_grid_kwh).toBe(50); // tightest
    expect(out.grid_caps[12].max_grid_kwh).toBe(50);
    expect(out.grid_caps[13].max_grid_kwh).toBe(50);
  });
});

describe("optimize (end-to-end)", () => {
  test("no directives: minimal-cost plan uses battery to reduce grid (battery is an asset)", async () => {
    // No directives; uniform tariff; the optimizer is free to discharge the
    // battery during demand to minimize cost. The contract is that the plan
    // (a) is feasible, (b) respects neutrality, (c) totals match recomputeTotals.
    // We assert (a)+(c) here; (b) is pinned by the neutrality test below.
    const hours = demandOnlyHours();
    for (const h of [10, 11, 12, 13, 14]) hours[h].solar_kwh = 30;
    const input: OptimizeInput = {
      hours: hours.map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [],
    };
    const result = await optimize(input);
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    // Totals must exactly match recomputeTotals from hourly_plan (PRD §5.7).
    const recomputed = recomputeTotals(result.output, tariffs());
    expect(result.output.total_grid_kwh).toBeCloseTo(recomputed.total_grid_kwh, 4);
    expect(result.output.total_cost_bdt).toBeCloseTo(recomputed.total_cost_bdt, 4);
    expect(result.output.peak_grid_kwh).toBeCloseTo(recomputed.peak_grid_kwh, 4);
    // Plan has 24 entries, all with finite, non-negative values.
    expect(result.output.hourly_plan.length).toBe(24);
    for (const entry of result.output.hourly_plan) {
      expect(entry.grid_kwh).toBeGreaterThanOrEqual(0);
      expect(entry.solar_used_kwh).toBeGreaterThanOrEqual(0);
      expect(entry.battery_energy_after_kwh).toBeGreaterThanOrEqual(0);
    }
  });

  test("solar_reduction to 0.25: optimizer reduces solar_used accordingly", async () => {
    const hours = demandOnlyHours();
    hours[12].solar_kwh = 20;
    hours[13].solar_kwh = 20;
    const input: OptimizeInput = {
      hours: hours.map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [vd("solar_reduction", { hours: [12, 13], factor: 0.25 })],
    };
    const result = await optimize(input);
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    // At h=12,13: effective solar = 20 * 0.25 = 5.
    expect(result.output.hourly_plan[12].solar_used_kwh).toBeCloseTo(5, 4);
    expect(result.output.hourly_plan[13].solar_used_kwh).toBeCloseTo(5, 4);
  });

  test("end-of-day neutrality: soc[23] == initial_energy_kwh", async () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery({ initial_energy_kwh: 75 }),
      directives: [],
    };
    const result = await optimize(input);
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    expect(result.output.hourly_plan[23].battery_energy_after_kwh).toBeCloseTo(75, 4);
  });

  test("max_grid_window caps grid_kwh at the directive value", async () => {
    const input: OptimizeInput = {
      hours: demandOnlyHours().map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery(),
      directives: [vd("max_grid_window", { hours: [18, 19, 20], max_grid_kwh: 20 })],
    };
    const result = await optimize(input);
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    for (const h of [18, 19, 20]) {
      expect(result.output.hourly_plan[h].grid_kwh).toBeLessThanOrEqual(20 + 1e-6);
    }
  });

  test("minimum_battery_reserve raises soc floor in active hours", async () => {
    // Make solar in the morning and high tariff in the evening so the optimizer
    // is forced to consider storing energy. With a high reserve floor at 18-20,
    // the optimizer must end hours 18-20 with soc >= 100 kWh. Initial = 50,
    // capacity = 200, charge cap = 100/h, demand 50.
    const hours = demandOnlyHours();
    hours[0].solar_kwh = 50;
    hours[0].tariff_bdt_per_kwh = 0; // off-peak
    hours[18].tariff_bdt_per_kwh = 10;
    hours[19].tariff_bdt_per_kwh = 10;
    hours[20].tariff_bdt_per_kwh = 10;
    const input: OptimizeInput = {
      hours: hours.map((h) => ({
        hour: h.hour,
        demand_kwh: h.demand_kwh,
        effective_solar_kwh: h.solar_kwh,
        tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
      })),
      battery: battery({ initial_energy_kwh: 50 }),
      directives: [vd("minimum_battery_reserve", { hours: [18, 19, 20], minimum_energy_kwh: 100 })],
    };
    const result = await optimize(input);
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    for (const h of [18, 19, 20]) {
      expect(result.output.hourly_plan[h].battery_energy_after_kwh).toBeGreaterThanOrEqual(100 - 1e-6);
    }
  });
});

describe("recomputeTotals", () => {
  test("totals match exactly when computed from the plan", () => {
    const plan: OptimizeOutput["hourly_plan"] = [
      { hour: 0, grid_kwh: 10, solar_used_kwh: 0, battery_action: "idle", battery_kwh: 0, battery_energy_after_kwh: 100 },
      { hour: 1, grid_kwh: 20, solar_used_kwh: 5, battery_action: "charge", battery_kwh: 3, battery_energy_after_kwh: 103 },
    ];
    const total = recomputeTotals(
      { hourly_plan: plan, total_grid_kwh: 0, total_cost_bdt: 0, peak_grid_kwh: 0 },
      [5, 7],
    );
    expect(total.total_grid_kwh).toBeCloseTo(30, 6);
    expect(total.total_cost_bdt).toBeCloseTo(10 * 5 + 20 * 7, 6);
    expect(total.peak_grid_kwh).toBeCloseTo(20, 6);
  });
});
