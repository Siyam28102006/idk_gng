import { describe, expect, test } from "bun:test";
import {
  sampleDemand,
  sampleSolar,
  sampleTariff,
  chartPath,
  sparkPath,
  batteryActionColor,
  directiveBadgeClass,
  recomputeTotals,
} from "@/lib/ui/sample-data";

// Sample data helpers power the local UI harness. They are pure
// functions so they live in src/lib/ui/ and can be unit-tested.

describe("sampleDemand — 24h curve", () => {
  test("returns 24 entries, ascending hours, demand ramps up at evening peak", () => {
    const d = sampleDemand();
    expect(d).toHaveLength(24);
    for (let i = 0; i < 24; i++) expect(d[i]!.hour).toBe(i);
    // Off-peak low; peak high.
    const min = Math.min(...d.map((x) => x.demand_kwh));
    const max = Math.max(...d.map((x) => x.demand_kwh));
    expect(max).toBeGreaterThan(min);
    expect(min).toBeGreaterThanOrEqual(20);
    expect(max).toBeLessThanOrEqual(200);
  });
});

describe("sampleSolar — 24h curve", () => {
  test("zero before sunrise and after sunset; positive in daylight", () => {
    const s = sampleSolar();
    expect(s).toHaveLength(24);
    expect(s[0]!.solar_kwh).toBe(0);
    expect(s[5]!.solar_kwh).toBe(0);
    expect(s[12]!.solar_kwh).toBeGreaterThan(0); // midday
    expect(s[18]!.solar_kwh).toBe(0); // sunset
  });
});

describe("sampleTariff — 24h curve", () => {
  test("peaks 17-21 (evening), off-peak elsewhere", () => {
    const t = sampleTariff();
    expect(t[0]!.tariff_bdt_per_kwh).toBeLessThan(t[18]!.tariff_bdt_per_kwh);
    expect(t[10]!.tariff_bdt_per_kwh).toBeLessThan(t[19]!.tariff_bdt_per_kwh);
  });
});

describe("chartPath", () => {
  test("returns SVG path string of correct shape: M ... L ... L ... L ...", () => {
    const path = chartPath([10, 20, 30, 20, 10], { width: 100, height: 40 });
    expect(path.startsWith("M")).toBe(true);
    expect(path.split("L")).toHaveLength(5); // 1 M + 4 L
  });

  test("min/max values map to bottom/top of viewport", () => {
    const path = chartPath([0, 50, 100], { width: 100, height: 40 });
    // First point (value 0) should be at y = height
    // Last point (value 100) should be at y = 0
    expect(path).toMatch(/M0,40 /);
    expect(path).toMatch(/ L100,0$/);
  });

  test("single point: returns M only", () => {
    const path = chartPath([42], { width: 100, height: 40 });
    expect(path).toBe("M0,20 ");
  });

  test("empty array: returns empty string", () => {
    expect(chartPath([], { width: 100, height: 40 })).toBe("");
  });
});

describe("sparkPath", () => {
  test("maps 24 numbers to an SVG path", () => {
    const arr = Array.from({ length: 24 }, (_, i) => Math.sin(i / 3) * 10 + 50);
    const p = sparkPath(arr, { width: 120, height: 32 });
    expect(p.startsWith("M")).toBe(true);
    expect(p.split("L")).toHaveLength(24);
  });
});

describe("batteryActionColor", () => {
  test("charge → emerald, discharge → teal, idle → slate", () => {
    expect(batteryActionColor("charge")).toMatch(/emerald/i);
    expect(batteryActionColor("discharge")).toMatch(/teal|cyan/i);
    expect(batteryActionColor("idle")).toMatch(/slate/i);
  });
});

describe("directiveBadgeClass", () => {
  test("returns Tailwind class strings per directive type", () => {
    expect(directiveBadgeClass("solar_reduction")).toMatch(/amber/i);
    expect(directiveBadgeClass("minimum_battery_reserve")).toMatch(/emerald/i);
    expect(directiveBadgeClass("no_charge_window")).toMatch(/violet|purple/i);
    expect(directiveBadgeClass("no_discharge_window")).toMatch(/rose/i);
    expect(directiveBadgeClass("max_grid_window")).toMatch(/cyan/i);
    expect(directiveBadgeClass("no_op")).toMatch(/slate/i);
  });
});

describe("recomputeTotals — UI-layer mirror", () => {
  test("totals match exactly within 6 decimals", () => {
    const plan = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      grid_kwh: 50,
      solar_used_kwh: 0,
      battery_action: "idle" as const,
      battery_kwh: 0,
      battery_energy_after_kwh: 100,
    }));
    const tariffs = Array(24).fill(7);
    const { total_grid_kwh, total_cost_bdt, peak_grid_kwh } = recomputeTotals(plan, tariffs);
    expect(total_grid_kwh).toBe(1200);
    expect(total_cost_bdt).toBe(8400);
    expect(peak_grid_kwh).toBe(50);
  });
});
