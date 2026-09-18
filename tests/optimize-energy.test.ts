import { describe, expect, test } from "bun:test";
import { POST } from "../src/app/optimize-energy/route";

function sampleRequest() {
  return {
    scenario_id: "tracer-01",
    operator_notes: [
      "Panel washing from one until three in the afternoon.",
      "The cafeteria menu changes tomorrow.",
    ],
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      demand_kwh: 100 + hour,
      solar_kwh: hour >= 6 && hour <= 18 ? 60 : 0,
      tariff_bdt_per_kwh: hour >= 17 && hour <= 21 ? 12 : 7,
    })),
    battery: {
      capacity_kwh: 200,
      initial_energy_kwh: 100,
      minimum_energy_kwh: 20,
      max_charge_kwh_per_hour: 50,
      max_discharge_kwh_per_hour: 50,
    },
  };
}

function post(body: unknown) {
  return new Request("http://localhost/optimize-energy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /optimize-energy validation", () => {
  test("rejects semantically invalid battery with 422 and no internals", async () => {
    const input = {
      ...sampleRequest(),
      battery: {
        capacity_kwh: 200,
        initial_energy_kwh: 100,
        minimum_energy_kwh: 250,
        max_charge_kwh_per_hour: 50,
        max_discharge_kwh_per_hour: 50,
      },
    };
    const res = await POST(post(input));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/stack|at .*\(.*\)/);
  });
});

describe("POST /optimize-energy happy path", () => {
  test("returns schema-valid plan with echo, ordering, and recomputable totals", async () => {
    const input = sampleRequest();
    const res = await POST(post(input));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.scenario_id).toBe("tracer-01");

    expect(body.directive_interpretation).toHaveLength(2);
    expect(
      body.directive_interpretation.map((d: { note_index: number }) => d.note_index),
    ).toEqual([0, 1]);

    expect(body.hourly_plan).toHaveLength(24);
    expect(body.hourly_plan.map((h: { hour: number }) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, h) => h),
    );
    for (const h of body.hourly_plan) {
      if (h.battery_action === "idle") expect(h.battery_kwh).toBe(0);
      expect(h.grid_kwh).toBeGreaterThanOrEqual(0);
    }

    const grid = body.hourly_plan.map((h: { grid_kwh: number }) => h.grid_kwh);
    const totalGrid = grid.reduce((a: number, b: number) => a + b, 0);
    const totalCost = body.hourly_plan.reduce(
      (sum: number, h: { grid_kwh: number }, i: number) =>
        sum + h.grid_kwh * input.hours[i].tariff_bdt_per_kwh,
      0,
    );
    expect(Math.abs(body.total_grid_kwh - totalGrid)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(body.total_cost_bdt - totalCost)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(body.peak_grid_kwh - Math.max(...grid))).toBeLessThanOrEqual(0.01);

    expect(
      Math.abs(
        body.hourly_plan[23].battery_energy_after_kwh -
          input.battery.initial_energy_kwh,
      ),
    ).toBeLessThanOrEqual(0.01);
    expect(typeof body.plan_summary).toBe("string");
  });
});
