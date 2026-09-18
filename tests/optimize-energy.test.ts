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
  test("rejects empty and non-string scenario_id with 400", async () => {
    const base = sampleRequest();
    expect((await POST(post({ ...base, scenario_id: "" }))).status).toBe(400);
    expect((await POST(post({ ...base, scenario_id: 42 }))).status).toBe(400);
  });
  test("accepts unsorted hours and returns ascending plan with correct totals", async () => {
    const base = sampleRequest();
    const input = {
      ...base,
      hours: [...base.hours].reverse(),
    };
    const res = await POST(post(input));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hourly_plan.map((h: { hour: number }) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, h) => h),
    );
    const grids = body.hourly_plan.map((h: { grid_kwh: number }) => h.grid_kwh);
    expect(Math.abs(body.total_grid_kwh - grids.reduce((a: number, b: number) => a + b, 0))).toBeLessThanOrEqual(0.01);
    const cost = body.hourly_plan.reduce(
      (sum: number, h: { grid_kwh: number; hour: number }) =>
        sum + h.grid_kwh * base.hours[h.hour].tariff_bdt_per_kwh,
      0,
    );
    expect(Math.abs(body.total_cost_bdt - cost)).toBeLessThanOrEqual(0.01);
  });
  test("rejects initial energy outside bounds with 422", async () => {
    const base = sampleRequest();
    const low = await POST(
      post({ ...base, battery: { ...base.battery, initial_energy_kwh: 10 } }),
    );
    expect(low.status).toBe(422);
    const high = await POST(
      post({ ...base, battery: { ...base.battery, initial_energy_kwh: 210 } }),
    );
    expect(high.status).toBe(422);
    expect(typeof (await high.json()).error).toBe("string");
  });
  test("rejects note counts outside 1-3 with 400", async () => {
    const base = sampleRequest();
    expect((await POST(post({ ...base, operator_notes: [] }))).status).toBe(400);
    expect(
      (await POST(post({ ...base, operator_notes: ["a", "b", "c", "d"] }))).status,
    ).toBe(400);
  });
  test("rejects malformed, short, and duplicate hours with 400", async () => {
    const malformed = await POST(post("{not json"));
    expect(malformed.status).toBe(400);
    expect(typeof (await malformed.json()).error).toBe("string");

    const base = sampleRequest();
    const short = await POST(post({ ...base, hours: base.hours.slice(0, 23) }));
    expect(short.status).toBe(400);

    const duped = await POST(
      post({ ...base, hours: base.hours.map((h, i) => (i === 0 ? base.hours[1] : h)) }),
    );
    expect(duped.status).toBe(400);
  });
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

describe("POST /optimize-energy note counts and solar cap", () => {
  test("handles 1 and 3 notes with one entry per note", async () => {
    for (const n of [1, 3]) {
      const input = {
        ...sampleRequest(),
        operator_notes: Array.from({ length: n }, (_, i) => `note ${i}`),
      };
      const res = await POST(post(input));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.directive_interpretation).toHaveLength(n);
      expect(
        body.directive_interpretation.map((d: { note_index: number }) => d.note_index),
      ).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
  test("caps solar use at demand when solar exceeds demand", async () => {
    const base = sampleRequest();
    const input = {
      ...base,
      hours: base.hours.map((h) => ({ ...h, demand_kwh: 10, solar_kwh: 100 })),
    };
    const res = await POST(post(input));
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const h of body.hourly_plan) {
      expect(h.solar_used_kwh).toBe(10);
      expect(h.grid_kwh).toBe(0);
    }
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
    for (const d of body.directive_interpretation) {
      expect(d.applies).toBe(false);
      expect(d.directive_type).toBe("no_op");
      expect(d.structured_adjustment).toBeNull();
    }

    expect(body.hourly_plan).toHaveLength(24);
    expect(body.hourly_plan.map((h: { hour: number }) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, h) => h),
    );
    for (const [i, h] of body.hourly_plan.entries()) {
      if (h.battery_action === "idle") expect(h.battery_kwh).toBe(0);
      expect(h.grid_kwh).toBeGreaterThanOrEqual(0);
      expect(h.solar_used_kwh).toBeGreaterThanOrEqual(0);
      expect(h.solar_used_kwh).toBeLessThanOrEqual(
        Math.min(input.hours[i].demand_kwh, input.hours[i].solar_kwh),
      );
      expect(h.grid_kwh + h.solar_used_kwh).toBeCloseTo(input.hours[i].demand_kwh, 2);
      expect(
        Math.abs(h.battery_energy_after_kwh - input.battery.initial_energy_kwh),
      ).toBeLessThanOrEqual(0.01);
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
