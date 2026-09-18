import { describe, expect, test } from "bun:test";
import { directiveSchema } from "../src/lib/llm/directive";
import { buildPrompt } from "../src/lib/llm/prompt";

const battery = {
  capacity_kwh: 200,
  initial_energy_kwh: 100,
  minimum_energy_kwh: 20,
  max_charge_kwh_per_hour: 50,
  max_discharge_kwh_per_hour: 50,
};

describe("directiveSchema", () => {
  test("accepts one fixture per each of the six types", () => {
    const fixtures = [
      { directive_type: "solar_reduction", structured_adjustment: { hours: [13, 14], factor: 0.2 } },
      { directive_type: "minimum_battery_reserve", structured_adjustment: { hours: [18, 19], minimum_energy_kwh: 100 } },
      { directive_type: "no_charge_window", structured_adjustment: { hours: [2, 3, 4] } },
      { directive_type: "no_discharge_window", structured_adjustment: { hours: [18, 19] } },
      { directive_type: "max_grid_window", structured_adjustment: { hours: [18, 19, 20], max_grid_kwh: 155 } },
      { directive_type: "no_op", structured_adjustment: null },
    ];
    for (const f of fixtures) {
      expect(directiveSchema.safeParse(f).success).toBe(true);
    }
  });
  test("rejects a seventh type and mismatched adjustment shapes", () => {
    expect(
      directiveSchema.safeParse({ directive_type: "shift_demand", structured_adjustment: { hours: [1] } }).success,
    ).toBe(false);
    expect(
      directiveSchema.safeParse({ directive_type: "solar_reduction", structured_adjustment: { hours: [1] } }).success,
    ).toBe(false);
    expect(
      directiveSchema.safeParse({ directive_type: "no_op", structured_adjustment: { hours: [1] } }).success,
    ).toBe(false);
  });
});

describe("buildPrompt", () => {
  test("embeds six types, battery capacity, and no_op guidance", () => {
    const prompt = buildPrompt("Panel washing 1-3 PM.", battery);
    for (const t of ["solar_reduction", "minimum_battery_reserve", "no_charge_window", "no_discharge_window", "max_grid_window", "no_op"]) {
      expect(prompt).toContain(t);
    }
    expect(prompt).toContain("200");
    expect(prompt).toContain("Panel washing 1-3 PM.");
  });
});
