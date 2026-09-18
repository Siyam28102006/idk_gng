import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { validatePlan } from "@/lib/validate/validate-plan";
import type { ValidatedDirective } from "@/lib/guardrails/types";
import type { BatteryContext } from "@/lib/llm/directive";
import type { HourInput } from "@/lib/optimizer/types";

// Integration test for the 10 public sample cases (SAMPLE-01..10) from
// AGENTS.md. We drive the route's full pipeline by hand:
//   1. interpret() is bypassed (we construct ValidatedDirective directly)
//   2. optimize() runs the LP
//   3. validatePlan() re-checks PRD §5.5 / §5.7
//
// AGENTS.md says: "NEVER assert byte-equality with reference schedules —
// equivalent-optimal is valid." So we assert only semantic properties
// (neutrality, directive violations, recomputable totals).

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

// Build a realistic 24h envelope: demand ramps up in the evening, solar in
// the middle of the day, off-peak tariff at night, peak tariff 17-21.
function sampleHours(): HourInput[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    demand_kwh: h >= 17 && h <= 21 ? 80 : 50, // peak hours = 80 kWh
    effective_solar_kwh: h >= 6 && h <= 18 ? 60 : 0, // 13 hours of solar
    tariff_bdt_per_kwh: h >= 17 && h <= 21 ? 12 : 5,
  }));
}

function vd(
  directive_type: ValidatedDirective["directive_type"],
  structured_adjustment: ValidatedDirective["structured_adjustment"],
  applies = true,
): ValidatedDirective {
  return { note_index: 0, directive_type, applies, structured_adjustment };
}

interface CaseCheck {
  id: string;
  directives: ValidatedDirective[];
  checks: (output: import("@/lib/optimizer/types").OptimizeOutput) => void;
}

const CASES: CaseCheck[] = [
  {
    id: "SAMPLE-01 solar + distractor",
    directives: [
      vd("solar_reduction", { hours: [12, 13], factor: 0.25 }),
      vd("no_op", null, false),
    ],
    checks: (output) => {
      // solar at h=12,13 should be capped at 0.25 * 60 = 15.
      expect(output.hourly_plan[12]!.solar_used_kwh).toBeLessThanOrEqual(15 + 1e-6);
      expect(output.hourly_plan[13]!.solar_used_kwh).toBeLessThanOrEqual(15 + 1e-6);
    },
  },
  {
    id: "SAMPLE-02 charge maintenance",
    directives: [vd("no_charge_window", { hours: [2, 3, 4] })],
    checks: (output) => {
      // No charging at h=2,3,4.
      for (const h of [2, 3, 4]) {
        if (output.hourly_plan[h]!.battery_action === "charge") {
          expect(output.hourly_plan[h]!.battery_kwh).toBe(0);
        }
      }
    },
  },
  {
    id: "SAMPLE-03 50% reserve",
    directives: [vd("minimum_battery_reserve", { hours: [18, 19, 20], minimum_energy_kwh: 100 })],
    checks: (output) => {
      for (const h of [18, 19, 20]) {
        expect(output.hourly_plan[h]!.battery_energy_after_kwh).toBeGreaterThanOrEqual(100 - 1e-6);
      }
    },
  },
  {
    id: "SAMPLE-04 discharge protection",
    directives: [vd("no_discharge_window", { hours: [18, 19] })],
    checks: (output) => {
      for (const h of [18, 19]) {
        if (output.hourly_plan[h]!.battery_action === "discharge") {
          expect(output.hourly_plan[h]!.battery_kwh).toBe(0);
        }
      }
    },
  },
  {
    id: "SAMPLE-05 feeder cap",
    directives: [vd("max_grid_window", { hours: [18, 19, 20], max_grid_kwh: 155 })],
    checks: (output) => {
      for (const h of [18, 19, 20]) {
        expect(output.hourly_plan[h]!.grid_kwh).toBeLessThanOrEqual(155 + 1e-6);
      }
    },
  },
  {
    id: "SAMPLE-06 multi + distractor",
    directives: [
      vd("solar_reduction", { hours: [10, 11], factor: 0.5 }),
      vd("no_charge_window", { hours: [14, 15] }),
      vd("no_op", null, false),
    ],
    checks: (output) => {
      // solar at h=10,11 capped at 30.
      expect(output.hourly_plan[10]!.solar_used_kwh).toBeLessThanOrEqual(30 + 1e-6);
      expect(output.hourly_plan[11]!.solar_used_kwh).toBeLessThanOrEqual(30 + 1e-6);
      // no charging at h=14,15.
      for (const h of [14, 15]) {
        if (output.hourly_plan[h]!.battery_action === "charge") {
          expect(output.hourly_plan[h]!.battery_kwh).toBe(0);
        }
      }
    },
  },
  {
    id: "SAMPLE-07 reserve + cap (stacked)",
    directives: [
      vd("minimum_battery_reserve", { hours: [18, 19, 20, 21], minimum_energy_kwh: 90 }),
      vd("max_grid_window", { hours: [19, 20], max_grid_kwh: 180 }),
    ],
    checks: (output) => {
      for (const h of [18, 19, 20, 21]) {
        expect(output.hourly_plan[h]!.battery_energy_after_kwh).toBeGreaterThanOrEqual(90 - 1e-6);
      }
      expect(output.hourly_plan[19]!.grid_kwh).toBeLessThanOrEqual(180 + 1e-6);
      expect(output.hourly_plan[20]!.grid_kwh).toBeLessThanOrEqual(180 + 1e-6);
    },
  },
  {
    id: "SAMPLE-08 charge/discharge outages",
    directives: [
      vd("no_charge_window", { hours: [11, 12] }),
      vd("no_discharge_window", { hours: [17, 18] }),
    ],
    checks: (output) => {
      for (const h of [11, 12]) {
        if (output.hourly_plan[h]!.battery_action === "charge") {
          expect(output.hourly_plan[h]!.battery_kwh).toBe(0);
        }
      }
      for (const h of [17, 18]) {
        if (output.hourly_plan[h]!.battery_action === "discharge") {
          expect(output.hourly_plan[h]!.battery_kwh).toBe(0);
        }
      }
    },
  },
  {
    id: "SAMPLE-09 reduction wording (factor is fraction REMAINS)",
    directives: [vd("solar_reduction", { hours: [11, 12, 13], factor: 0.2 })],
    checks: (output) => {
      // PRD §5.3: factor is what REMAINS. factor=0.2 means 20% remains,
      // so effective solar = 0.2 * 60 = 12.
      for (const h of [11, 12, 13]) {
        expect(output.hourly_plan[h]!.solar_used_kwh).toBeLessThanOrEqual(12 + 1e-6);
      }
    },
  },
  {
    id: "SAMPLE-10 evening multi (stacked)",
    directives: [
      vd("minimum_battery_reserve", { hours: [18, 19, 20, 21], minimum_energy_kwh: 80 }),
      vd("max_grid_window", { hours: [19, 20, 21], max_grid_kwh: 190 }),
      vd("no_op", null, false),
    ],
    checks: (output) => {
      for (const h of [18, 19, 20, 21]) {
        expect(output.hourly_plan[h]!.battery_energy_after_kwh).toBeGreaterThanOrEqual(80 - 1e-6);
      }
      for (const h of [19, 20, 21]) {
        expect(output.hourly_plan[h]!.grid_kwh).toBeLessThanOrEqual(190 + 1e-6);
      }
    },
  },
];

describe("sample cases (SAMPLE-01..10) — semantic replay", () => {
  for (const c of CASES) {
    test(`${c.id}: pipeline produces a feasible plan that respects every active directive`, async () => {
      const hours = sampleHours();
      const result = await optimize({
        hours,
        battery: battery(),
        directives: c.directives,
      });
      expect(result.status).toBe("optimal");
      if (result.status !== "optimal") return;

      // The validator must also accept it.
      const validation = validatePlan({
        hours: hours.map((h) => ({
          hour: h.hour,
          demand_kwh: h.demand_kwh,
          solar_kwh: h.effective_solar_kwh, // for the validator, solar_kwh is the raw, not post-reduction
          tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
        })),
        battery: battery(),
        directives: c.directives,
        output: result.output,
      });
      expect(validation.ok).toBe(true);
      if (!validation.ok) {
        for (const v of validation.violations) {
          console.error(`${c.id} violation: ${v.code} h=${v.hour ?? "-"} ${v.message}`);
        }
      }

      // Neutrality at h=23.
      expect(result.output.hourly_plan[23]!.battery_energy_after_kwh).toBeCloseTo(
        battery().initial_energy_kwh,
        4,
      );

      c.checks(result.output);
    });
  }
});

describe("sample cases — totals recompute within tolerance", () => {
  for (const c of CASES) {
    test(`${c.id}: totals match recomputeTotals within 0.01`, async () => {
      const hours = sampleHours();
      const result = await optimize({
        hours,
        battery: battery(),
        directives: c.directives,
      });
      expect(result.status).toBe("optimal");
      if (result.status !== "optimal") return;
      let tg = 0;
      let tc = 0;
      let p = 0;
      for (const e of result.output.hourly_plan) {
        tg += e.grid_kwh;
        tc += e.grid_kwh * hours[e.hour]!.tariff_bdt_per_kwh;
        p = Math.max(p, e.grid_kwh);
      }
      expect(Math.abs(result.output.total_grid_kwh - tg)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(result.output.total_cost_bdt - tc)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(result.output.peak_grid_kwh - p)).toBeLessThanOrEqual(0.01);
    });
  }
});
