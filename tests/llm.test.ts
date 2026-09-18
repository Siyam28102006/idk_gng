import { describe, expect, test } from "bun:test";
import { directiveSchema } from "../src/lib/llm/directive";
import { buildPrompt } from "../src/lib/llm/prompt";
import { interpretNotes, LlmError } from "../src/lib/llm/interpret";

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

describe("interpretNotes", () => {
  test("preserves note order across parallel calls", async () => {
    const client = {
      generate: async (prompt: string) => {
        const delay = prompt.includes("first note") ? 30 : 0;
        await new Promise((r) => setTimeout(r, delay));
        return { directive_type: "no_op", structured_adjustment: null };
      },
    };
    const out = await interpretNotes(["first note", "second note", "third note"], battery, client);
    expect(out).toHaveLength(3);
    for (const c of out) {
      expect(c.directive_type).toBe("no_op");
      expect(c.structured_adjustment).toBeNull();
    }
  });
  test("maps invalid candidates and client failures to LlmError", async () => {
    const badClient = { generate: async () => ({ directive_type: "shift_demand" }) };
    await expect(interpretNotes(["x"], battery, badClient)).rejects.toBeInstanceOf(LlmError);
    const failingClient = {
      generate: async () => { throw new Error("provider down"); },
    };
    await expect(interpretNotes(["x"], battery, failingClient)).rejects.toBeInstanceOf(LlmError);
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
