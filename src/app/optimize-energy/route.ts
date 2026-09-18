import { optimizeRequestSchema, type OptimizeRequest } from "@/lib/schemas";
import { interpretNotes, LlmError } from "@/lib/llm/interpret";
import { validateGuardrails } from "@/lib/guardrails/validate";
import { optimize } from "@/lib/optimizer/optimize";
import { validatePlan } from "@/lib/validate/validate-plan";

// Hard ceiling for the entire optimize pipeline. PRD §6 NFR: every request
// settles inside 30s. With LLM attempts at 9s × 2 providers = 18s budget
// and the LP solve typically <100ms, 25s gives headroom for cold-start
// HiGHS WASM init on the first request after deploy.
const PIPELINE_TIMEOUT_MS = 25_000;

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

  // Race the pipeline against an overall deadline. The route never hangs:
  // if LLM or solver stalls, we surface a controlled 500 with a generic
  // message and never leak the timeout to the client body.
  const pipelineTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("pipeline_timeout")), PIPELINE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([runPipeline(input), pipelineTimeout]);
    if (result.kind === "ok") {
      return Response.json(result.body, { status: 200 });
    }
    if (result.kind === "solver_infeasible") {
      return Response.json({ error: "no feasible dispatch" }, { status: 422 });
    }
    return Response.json({ error: "internal error" }, { status: 500 });
  } catch (e) {
    if (e instanceof LlmError) {
      console.warn(`llm_error kind=${e.kind}`);
      return Response.json({ error: "interpretation failed" }, { status: 500 });
    }
    if (e instanceof Error && e.message === "pipeline_timeout") {
      console.error("pipeline_timeout (overall budget exceeded)");
      return Response.json({ error: "request timed out" }, { status: 504 });
    }
    // Defense-in-depth: never echo solver/LP internals. Generic log + 500.
    console.error("internal_error", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}

type PipelineResult =
  | { kind: "ok"; body: unknown }
  | { kind: "solver_infeasible"; detail: string }
  | { kind: "solver_error"; detail: string };

async function runPipeline(input: OptimizeRequest): Promise<PipelineResult> {
  const candidates = await interpretNotes(input.operator_notes, input.battery);
  // Guardrail is the contract between LLM output and optimizer. Malformed
  // candidates become flagged no_op and never reach the optimizer as
  // unvalidated directives. fallback_reasons is logged (generic strings;
  // no note text, no LLM internals) and never returned to the client.
  const validated = validateGuardrails(candidates, input.operator_notes, input.battery);
  for (const fb of validated.fallback_reasons) {
    console.warn(`guardrail_fallback note_index=${fb.note_index} reason=${fb.reason}`);
  }

  // The optimizer expects hours sorted ascending by hour; sort once here
  // and reuse the same ordering for validatePlan. The request schema
  // accepts any order (Set uniqueness is the only invariant).
  const sortedHours = [...input.hours].sort((a, b) => a.hour - b.hour);

  const result = await optimize({
    hours: sortedHours.map((h) => ({
      hour: h.hour,
      demand_kwh: h.demand_kwh,
      effective_solar_kwh: h.solar_kwh,
      tariff_bdt_per_kwh: h.tariff_bdt_per_kwh,
    })),
    battery: input.battery,
    directives: validated.directives,
  });

  if (result.status === "infeasible") {
    return { kind: "solver_infeasible", detail: result.failure_reason };
  }
  if (result.status === "error") {
    return { kind: "solver_error", detail: result.detail ?? result.failure_reason };
  }

  const validation = validatePlan({
    hours: sortedHours,
    battery: input.battery,
    directives: validated.directives,
    output: result.output,
  });
  if (!validation.ok) {
    // PRD §5.5 / §5.7 invariant broke — log the violations (no secrets, no
    // operator note text) and surface a generic 500 to the client.
    for (const v of validation.violations) {
      console.error(`validate_violation code=${v.code} hour=${v.hour ?? "-"} msg=${v.message}`);
    }
    return { kind: "solver_error", detail: "validate_plan_rejected" };
  }

  return {
    kind: "ok",
    body: {
      scenario_id: input.scenario_id,
      directive_interpretation: validated.directives.map((d) => ({
        note_index: d.note_index,
        applies: d.applies,
        directive_type: d.directive_type,
        structured_adjustment: d.structured_adjustment,
        explanation: `LLM interpretation: ${d.directive_type}`,
      })),
      hourly_plan: result.output.hourly_plan,
      total_grid_kwh: result.output.total_grid_kwh,
      total_cost_bdt: result.output.total_cost_bdt,
      peak_grid_kwh: result.output.peak_grid_kwh,
      plan_summary: summarizePlan(result.output.hourly_plan, validated.directives),
    },
  };
}

function summarizePlan(
  hourlyPlan: { hour: number; battery_action: "charge" | "discharge" | "idle"; battery_kwh: number }[],
  directives: { directive_type: string; applies: boolean }[],
): string {
  const chargeHours = hourlyPlan.filter((e) => e.battery_action === "charge").length;
  const dischargeHours = hourlyPlan.filter((e) => e.battery_action === "discharge").length;
  const applied = directives.filter((d) => d.applies && d.directive_type !== "no_op").length;
  return `Dispatched across 24h: ${chargeHours} charging hours, ${dischargeHours} discharging hours; ${applied} directive(s) applied.`;
}
