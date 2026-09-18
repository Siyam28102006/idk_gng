import { optimizeRequestSchema } from "@/lib/schemas";

interface HourlyEntry {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: "charge" | "discharge" | "idle";
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

// Tracer stub: one no_op per note. Epic e02 replaces this with the real LLM call.
function stubInterpretation(notes: string[]) {
  return notes.map((_, note_index) => ({
    note_index,
    applies: false,
    directive_type: "no_op",
    structured_adjustment: null,
    explanation: "Tracer stub: no_op pending real LLM interpretation (e02).",
  }));
}

// Trivially feasible plan: solar first, grid for the remainder, battery idle.
function trivialPlan(req: {
  hours: { hour: number; demand_kwh: number; solar_kwh: number }[];
  battery: { initial_energy_kwh: number };
}): HourlyEntry[] {
  return req.hours.map((h) => {
    const solar_used_kwh = Math.min(h.demand_kwh, h.solar_kwh);
    return {
      hour: h.hour,
      grid_kwh: h.demand_kwh - solar_used_kwh,
      solar_used_kwh,
      battery_action: "idle",
      battery_kwh: 0,
      battery_energy_after_kwh: req.battery.initial_energy_kwh,
    };
  });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "malformed JSON" }, { status: 400 });
  }

  const parsed = optimizeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  if (
    input.battery.initial_energy_kwh < input.battery.minimum_energy_kwh ||
    input.battery.initial_energy_kwh > input.battery.capacity_kwh
  ) {
    return Response.json({ error: "initial energy outside battery bounds" }, { status: 422 });
  }

  try {
    const hourly_plan = trivialPlan(input);
    const total_grid_kwh = hourly_plan.reduce((s, h) => s + h.grid_kwh, 0);
    const total_cost_bdt = hourly_plan.reduce(
      (s, h, i) => s + h.grid_kwh * input.hours[i].tariff_bdt_per_kwh,
      0,
    );
    return Response.json({
      scenario_id: input.scenario_id,
      directive_interpretation: stubInterpretation(input.operator_notes),
      hourly_plan,
      total_grid_kwh,
      total_cost_bdt,
      peak_grid_kwh: Math.max(...hourly_plan.map((h) => h.grid_kwh)),
      plan_summary: "Tracer stub: solar-first dispatch, battery idle.",
    });
  } catch {
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
