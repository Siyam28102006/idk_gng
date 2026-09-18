import { describe, expect, test } from "bun:test";
import { buildLpText, varName } from "@/lib/optimizer/build-lp";
import type {
  HourInput,
  HourFloor,
  HourChargeCap,
  HourGridCap,
} from "@/lib/optimizer/types";

// Helper builders so tests stay readable.
function hours(overrides: Partial<HourInput>[] = []): HourInput[] {
  const out: HourInput[] = [];
  for (let h = 0; h < 24; h++) {
    out.push({
      hour: h,
      demand_kwh: 50,
      effective_solar_kwh: 10,
      tariff_bdt_per_kwh: 5,
      ...overrides[h],
    });
  }
  return out;
}

function floors(min = 0): HourFloor[] {
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, minimum_energy_kwh: min }));
}

function caps(chargeMax = 100, dischargeMax = 100): HourChargeCap[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    max_charge_kwh: chargeMax,
    max_discharge_kwh: dischargeMax,
  }));
}

// "no cap" is signalled with Number.POSITIVE_INFINITY so build_lp's num()
// formatter emits "1e30" (the LP convention for unbounded above) instead of
// "1000000000000.000000". The cap tests below pick finite values where they
// need a real cap.
function gridCaps(max = Number.POSITIVE_INFINITY): HourGridCap[] {
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, max_grid_kwh: max }));
}

describe("buildLpText", () => {
  test("names the five variables per hour", () => {
    // Build a tiny LP and look for all 120 variable names (5 vars × 24 hrs).
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    for (let h = 0; h < 24; h++) {
      for (const kind of ["g", "s", "c", "d", "soc"] as const) {
        expect(lp).toContain(varName(h, kind));
      }
    }
  });

  test("includes the neutrality constraint soc23 = initial", () => {
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 75,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    expect(lp).toContain(`soc23 = ${(75).toFixed(6)}`);
  });

  test("h=0 transition uses initial_energy_kwh as prior SoC", () => {
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 42,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    // soc[0] - c[0] + d[0] = initial  →  soc0 - c0 + d0 = 42.000000
    expect(lp).toMatch(/soc0:\s+soc0 - c0 \+ d0 = 42\.000000/);
  });

  test("h>0 transition chains soc[h] - soc[h-1] - c[h] + d[h] = 0", () => {
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    expect(lp).toMatch(/soc1:\s+soc1 - soc0 - c1 \+ d1 = 0/);
    expect(lp).toMatch(/soc12:\s+soc12 - soc11 - c12 \+ d12 = 0/);
  });

  test("balance row sets g + s + d - c = demand", () => {
    const h = hours();
    h[5].demand_kwh = 77;
    const lp = buildLpText({
      hours: h,
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    expect(lp).toContain(`bal5: g5 + s5 + d5 - c5 = ${(77).toFixed(6)}`);
  });

  test("objective only includes g[h]*tariff[h] for non-zero tariffs", () => {
    const h = hours();
    h[3].tariff_bdt_per_kwh = 0; // tariff = 0 → omitted from objective
    const lp = buildLpText({
      hours: h,
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    // h=3 tariff is 0 → should NOT have a term for g3 in the objective line.
    const objLine = lp.split("\n").find((l) => l.trim().startsWith("obj:")) ?? "";
    expect(objLine).not.toContain("g3 ");
    // But h=0 (tariff 5) is present.
    expect(objLine).toContain("g0 ");
  });

  test("solar_used bound uses effective_solar_kwh", () => {
    const h = hours();
    h[10].effective_solar_kwh = 3.5;
    const lp = buildLpText({
      hours: h,
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    expect(lp).toContain(`0 <= s10 <= ${(3.5).toFixed(6)}`);
  });

  test("soc bound uses per-hour floor (raised by minimum_battery_reserve)", () => {
    const f = floors(0);
    f[18].minimum_energy_kwh = 90;
    f[19].minimum_energy_kwh = 90;
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: f,
      charge_caps: caps(),
      grid_caps: gridCaps(),
    });
    expect(lp).toContain(` ${(90).toFixed(6)} <= soc18 <= ${(200).toFixed(6)}`);
    expect(lp).toContain(` ${(0).toFixed(6)} <= soc0 <= ${(200).toFixed(6)}`);
  });

  test("charge/discharge bounds reflect per-hour caps (0 in no_*_window hours)", () => {
    const c = caps();
    c[14].max_charge_kwh = 0; // no_charge_window active at h=14
    c[18].max_discharge_kwh = 0; // no_discharge_window active at h=18
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: c,
      grid_caps: gridCaps(),
    });
    expect(lp).toContain(`0 <= c14 <= ${(0).toFixed(6)}`);
    expect(lp).toContain(`0 <= d18 <= ${(0).toFixed(6)}`);
  });

  test("grid bound reflects per-hour max_grid_kwh (max_grid_window cap)", () => {
    const g = gridCaps(Number.POSITIVE_INFINITY); // default unbounded
    g[19].max_grid_kwh = 180;
    g[20].max_grid_kwh = 180;
    const lp = buildLpText({
      hours: hours(),
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      floors: floors(),
      charge_caps: caps(),
      grid_caps: g,
    });
    expect(lp).toContain(`0 <= g19 <= ${(180).toFixed(6)}`);
    expect(lp).toContain(`0 <= g20 <= ${(180).toFixed(6)}`);
    // h=0 still has the default huge cap (test exact phrasing — format uses 1e30 for +inf).
    expect(lp).toMatch(/0 <= g0 <= 1e30/);
  });

  test("rejects non-ascending or wrong-length per-hour overrides", () => {
    const badFloors = floors();
    badFloors[5] = { hour: 6, minimum_energy_kwh: 0 }; // out of order
    expect(() =>
      buildLpText({
        hours: hours(),
        capacity_kwh: 200,
        initial_energy_kwh: 100,
        floors: badFloors,
        charge_caps: caps(),
        grid_caps: gridCaps(),
      }),
    ).toThrow();
  });
});
