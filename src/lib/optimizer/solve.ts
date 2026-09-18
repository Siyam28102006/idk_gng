import loadHighs from "highs";
import { varName } from "./build-lp";
import type { HourlyEntry, SolveResult } from "./types";

// Module-level singleton. HiGHS WASM is loaded once per process; reusing the
// loaded instance across requests is the documented fast path (per
// https://www.npmjs.com/package/highs: "Persistent models hold native Wasm
// memory until model.dispose()"). Since we use the one-shot solve() API per
// request, there is nothing to dispose — we just keep `highs` warm.
let highsInstance: Awaited<ReturnType<typeof loadHighs>> | null = null;
let loadingPromise: Promise<Awaited<ReturnType<typeof loadHighs>>> | null = null;

// Lazy + dedup'd load. Multiple concurrent requests on cold-start won't all
// race the WASM init.
export async function getHighs(): Promise<Awaited<ReturnType<typeof loadHighs>>> {
  if (highsInstance) return highsInstance;
  if (!loadingPromise) {
    loadingPromise = loadHighs().then((h) => {
      highsInstance = h;
      return h;
    });
  }
  return loadingPromise;
}

// Solve a previously-built LP and shape the result into OptimizeOutput.
//
// PRD §5.5: variable bounds and constraints are encoded in the LP text; this
// function just hands the text to highs and reads back the column values.
// The hourly_plan is the only thing solveLp computes; the response-level
// totals (total_grid_kwh, total_cost_bdt, peak_grid_kwh) are derived from
// hourly_plan by the orchestrator (recomputeTotals) so that the PRD §5.7
// contract "exactly recomputable from hourly_plan within tolerance" is
// enforced by construction. solveLp returns the totals as 0 placeholders.
export async function solveLp(lpText: string): Promise<SolveResult> {
  let highs;
  try {
    highs = await getHighs();
  } catch (e) {
    return {
      status: "error",
      failure_reason: "build_error",
      detail: e instanceof Error ? e.message : "highs init failed",
    };
  }

  let result;
  try {
    result = highs.solve(lpText);
  } catch (e) {
    return {
      status: "error",
      failure_reason: "solver_error",
      detail: e instanceof Error ? e.message : "solver threw",
    };
  }

  // HiGHS Status taxonomy: "Optimal", "Infeasible", "Unbounded", "Objective
  // bound reached", "Time limit reached", etc. We treat anything other than
  // "Optimal" as non-success and surface a typed failure_reason.
  if (result.Status !== "Optimal") {
    if (result.Status === "Infeasible") {
      return { status: "infeasible", failure_reason: "lp_infeasible" };
    }
    if (result.Status === "Unbounded") {
      return { status: "infeasible", failure_reason: "lp_unbounded" };
    }
    return {
      status: "error",
      failure_reason: "solver_error",
      detail: `HiGHS status: ${result.Status}`,
    };
  }

  // Reconstruct the 24-hour dispatch plan from the column primitives.
  const cols = result.Columns;
  const hourly_plan: HourlyEntry[] = [];
  for (let h = 0; h < 24; h++) {
    const grid_kwh = num(cols[varName(h, "g")].Primal);
    const solar_used_kwh = num(cols[varName(h, "s")].Primal);
    const charge_kwh = num(cols[varName(h, "c")].Primal);
    const discharge_kwh = num(cols[varName(h, "d")].Primal);
    const soc = num(cols[varName(h, "soc")].Primal);

    // battery_kwh is the magnitude of action; battery_action is the sign.
    // PRD §5.7: "battery_kwh must be 0 whenever battery_action = idle".
    let battery_action: "charge" | "discharge" | "idle";
    let battery_kwh: number;
    if (charge_kwh > 1e-6 && discharge_kwh <= 1e-6) {
      battery_action = "charge";
      battery_kwh = round(charge_kwh);
    } else if (discharge_kwh > 1e-6 && charge_kwh <= 1e-6) {
      battery_action = "discharge";
      battery_kwh = round(discharge_kwh);
    } else if (charge_kwh > 1e-6 && discharge_kwh > 1e-6) {
      // Theoretically impossible: balance + bounds forbid simultaneous
      // charge & discharge unless both are zero (a binding 0 cap forces
      // one to 0). If we somehow get both, fall back to whichever is larger.
      if (charge_kwh >= discharge_kwh) {
        battery_action = "charge";
        battery_kwh = round(charge_kwh);
      } else {
        battery_action = "discharge";
        battery_kwh = round(discharge_kwh);
      }
    } else {
      battery_action = "idle";
      battery_kwh = 0;
    }

    hourly_plan.push({
      hour: h,
      grid_kwh: round(grid_kwh),
      solar_used_kwh: round(solar_used_kwh),
      battery_action,
      battery_kwh,
      battery_energy_after_kwh: round(soc),
    });
  }
  // Totals are placeholders; the orchestrator overwrites them via
  // recomputeTotals before returning to the route.
  return {
    status: "optimal",
    output: {
      hourly_plan,
      total_grid_kwh: 0,
      total_cost_bdt: 0,
      peak_grid_kwh: 0,
    },
  };
}

// Number coercion: HiGHS returns numbers; defensively coerce in case a future
// version returns strings or undefined.
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  return 0;
}

// Round to 6 decimals for read-back (matches the LP text's 6-decimal format
// so totals recompute identically within 0.01 tolerance).
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
