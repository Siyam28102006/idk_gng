import { describe, expect, test } from "bun:test";
import { validateGuardrails } from "@/lib/guardrails/validate";
import type { BatteryContext } from "@/lib/llm/directive";

const battery: BatteryContext = {
  capacity_kwh: 200,
  initial_energy_kwh: 100,
  minimum_energy_kwh: 20,
  max_charge_kwh_per_hour: 50,
  max_discharge_kwh_per_hour: 50,
};

describe("validateGuardrails — six-type happy path", () => {
  test("returns one validated directive per note with ascending note_index", () => {
    const notes = [
      "Solar reduction 1-3pm, 80% gone",
      "Keep at least 100 kWh battery at 6-9pm",
      "No discharge 6-9pm",
      "Grid cap 100 kWh at 6-9pm",
      "No charge 1-3am",
      "Cafeteria menu changes tomorrow",
    ];
    const candidates = [
      { directive_type: "solar_reduction", structured_adjustment: { hours: [13, 14], factor: 0.2 } },
      { directive_type: "minimum_battery_reserve", structured_adjustment: { hours: [18, 19, 20], minimum_energy_kwh: 100 } },
      { directive_type: "no_discharge_window", structured_adjustment: { hours: [18, 19, 20] } },
      { directive_type: "max_grid_window", structured_adjustment: { hours: [18, 19, 20], max_grid_kwh: 100 } },
      { directive_type: "no_charge_window", structured_adjustment: { hours: [1, 2] } },
      { directive_type: "no_op", structured_adjustment: null },
    ];

    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives).toHaveLength(notes.length);
    expect(result.directives.map((d) => d.note_index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.fallback_reasons).toEqual([]);
    expect(result.directives[0].directive_type).toBe("solar_reduction");
    expect(result.directives[0].applies).toBe(true);
    expect(result.directives[5].directive_type).toBe("no_op");
    expect(result.directives[5].applies).toBe(false);
    expect(result.directives[5].structured_adjustment).toBeNull();
  });
});

describe("validateGuardrails — fallback path", () => {
  test("factor outside [0, 1] becomes flagged no_op with factor_out_of_range", () => {
    const notes = ["bad factor high", "bad factor low"];
    const candidates = [
      { directive_type: "solar_reduction", structured_adjustment: { hours: [13, 14], factor: 1.5 } },
      { directive_type: "solar_reduction", structured_adjustment: { hours: [13, 14], factor: -0.1 } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives).toHaveLength(2);
    for (const d of result.directives) {
      expect(d.directive_type).toBe("no_op");
      expect(d.applies).toBe(false);
    }
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "factor_out_of_range" },
      { note_index: 1, reason: "factor_out_of_range" },
    ]);
  });

  test("hours outside 0-23 (out of LLM schema range) surface as shape_invalid", () => {
    // The LLM schema enforces int + 0..23 at the type level; the guardrail
    // only sees candidates that already passed type-check, so the "out of
    // range" reason is owned by the LLM schema (this test pins the contract).
    const notes = ["high hour", "low hour"];
    const candidates = [
      { directive_type: "solar_reduction", structured_adjustment: { hours: [24], factor: 0.5 } },
      { directive_type: "solar_reduction", structured_adjustment: { hours: [-1, 5], factor: 0.5 } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives.every((d) => d.directive_type === "no_op")).toBe(true);
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "shape_invalid" },
      { note_index: 1, reason: "shape_invalid" },
    ]);
  });

  test("hours not strictly ascending become flagged no_op with hours_unsorted", () => {
    const notes = ["out of order"];
    const candidates = [
      { directive_type: "no_charge_window", structured_adjustment: { hours: [10, 5, 8] } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives[0].directive_type).toBe("no_op");
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "hours_unsorted" },
    ]);
  });

  test("hours with duplicates become flagged no_op with hours_duplicated", () => {
    const notes = ["dupes"];
    const candidates = [
      { directive_type: "no_charge_window", structured_adjustment: { hours: [5, 5, 8] } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives[0].directive_type).toBe("no_op");
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "hours_duplicated" },
    ]);
  });

  test("reserve above capacity becomes flagged no_op with reserve_out_of_bounds", () => {
    const notes = ["too high reserve", "negative reserve"];
    const candidates = [
      { directive_type: "minimum_battery_reserve", structured_adjustment: { hours: [18, 19], minimum_energy_kwh: 500 } },
      { directive_type: "minimum_battery_reserve", structured_adjustment: { hours: [18, 19], minimum_energy_kwh: -1 } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives.every((d) => d.directive_type === "no_op")).toBe(true);
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "reserve_out_of_bounds" },
      { note_index: 1, reason: "reserve_out_of_bounds" },
    ]);
  });

  test("negative grid cap becomes flagged no_op with cap_negative", () => {
    const notes = ["bad cap"];
    const candidates = [
      { directive_type: "max_grid_window", structured_adjustment: { hours: [18, 19], max_grid_kwh: -5 } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives[0].directive_type).toBe("no_op");
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "cap_negative" },
    ]);
  });

  test("unknown directive_type becomes flagged no_op with shape_invalid", () => {
    const notes = ["seventh-type-style sabotage"];
    const candidates = [
      { directive_type: "solar_increase", structured_adjustment: { hours: [13, 14], factor: 0.2 } },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives[0].directive_type).toBe("no_op");
    expect(result.fallback_reasons).toEqual([
      { note_index: 0, reason: "shape_invalid" },
    ]);
  });

  test("missing candidates are filled with flagged no_op and candidates_missing", () => {
    const notes = ["first", "second", "third"];
    const candidates = [
      { directive_type: "no_op", structured_adjustment: null },
    ];
    const result = validateGuardrails(candidates, notes, battery);

    expect(result.directives).toHaveLength(3);
    expect(result.directives.every((d) => d.directive_type === "no_op")).toBe(true);
    expect(result.fallback_reasons).toEqual([
      { note_index: 1, reason: "candidates_missing" },
      { note_index: 2, reason: "candidates_missing" },
    ]);
  });

  test("never throws on garbage input", () => {
    const notes = ["a", "b"];
    const candidates: unknown[] = [null, { random: "shape" }];
    expect(() => validateGuardrails(candidates, notes, battery)).not.toThrow();
  });
});
