import { optimizeRequestSchema, type OptimizeRequest } from "@/lib/schemas";
import { interpretNotes, LlmError } from "@/lib/llm/interpret";
import { validateGuardrails } from "@/lib/guardrails/validate";

interface HourlyEntry {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: "charge" | "discharge" | "idle";
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

// Trivially feasible plan: solar first, grid for the remainder, battery idle.
// Single pass over ascending hours so plan order and tariff attribution share
// one ordering — no positional join between arrays.
function trivialPlan(req: OptimizeRequest): {
  hourly_plan: HourlyEntry[];
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
} {
  const hourly_plan: HourlyEntry[] = [];
  let total_grid_kwh = 0;
  let total_cost_bdt = 0;
  let peak_grid_kwh = 0;
  for (const h of [...req.hours].sort((a, b) => a.hour - b.hour)) {
    const solar_used_kwh = Math.min(h.demand_kwh, h.solar_kwh);
    const grid_kwh = h.demand_kwh - solar_used_kwh;
    hourly_plan.push({
      hour: h.hour,
      grid_kwh,
      solar_used_kwh,
      battery_action: "idle",
      battery_kwh: 0,
      battery_energy_after_kwh: req.battery.initial_energy_kwh,
    });
    total_grid_kwh += grid_kwh;
    total_cost_bdt += grid_kwh * h.tariff_bdt_per_kwh;
    peak_grid_kwh = Math.max(peak_grid_kwh, grid_kwh);
  }
  return { hourly_plan, total_grid_kwh, total_cost_bdt, peak_grid_kwh };
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

  if (input.battery.minimum_energy_kwh > input.battery.capacity_kwh) {
    return Response.json({ error: "minimum above capacity" }, { status: 422 });
  }
  if (
    input.battery.initial_energy_kwh < input.battery.minimum_energy_kwh ||
    input.battery.initial_energy_kwh > input.battery.capacity_kwh
  ) {
    return Response.json({ error: "initial energy outside battery bounds" }, { status: 422 });
  }

  try {
    const candidates = await interpretNotes(input.operator_notes, input.battery);
    // Guardrail is the contract between LLM output and optimizer. Malformed
    // candidates become flagged no_op and never reach the optimizer as
    // unvalidated directives. fallback_reasons is logged (generic strings;
    // no note text, no LLM internals) and never returned to the client.
    const validated = validateGuardrails(candidates, input.operator_notes, input.battery);
    for (const fb of validated.fallback_reasons) {
      console.warn(
        `guardrail_fallback note_index=${fb.note_index} reason=${fb.reason}`,
      );
    }
    const { hourly_plan, total_grid_kwh, total_cost_bdt, peak_grid_kwh } =
      trivialPlan(input);
    return Response.json({
      scenario_id: input.scenario_id,
      directive_interpretation: validated.directives.map((d) => ({
        note_index: d.note_index,
        applies: d.applies,
        directive_type: d.directive_type,
        structured_adjustment: d.structured_adjustment,
        explanation: `LLM interpretation: ${d.directive_type}`,
      })),
      hourly_plan,
      total_grid_kwh,
      total_cost_bdt,
      peak_grid_kwh,
      plan_summary: "Tracer stub: solar-first dispatch, battery idle.",
    });
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: "interpretation failed" }, { status: 500 });
    }
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
