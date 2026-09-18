import type { HourInput, HourFloor, HourChargeCap, HourGridCap } from "./types";

// Variable name per (hour, kind). Kinds are g/s/c/d for grid/solar_used/charge/discharge
// plus an extra "soc" state variable per hour. Keeping names short keeps the LP text
// legible and the parser's job cheap.
export type VarKind = "g" | "s" | "c" | "d" | "soc";

export function varName(hour: number, kind: VarKind): string {
  return `${kind}${hour}`;
}

// Build the CPLEX-LP text for HiGHS. Returns a string ready for highs.solve().
//
// Variables per hour h:
//   g[h]    grid_kwh >= 0
//   s[h]    solar_used_kwh in [0, effective_solar[h]]
//   c[h]    charge_kwh   in [0, max_charge[h]]
//   d[h]    discharge_kwh in [0, max_discharge[h]]
//   soc[h]  battery_energy_after_kwh in [floor[h], capacity]
// Constraints:
//   (1) balance: g[h] + s[h] + d[h] - c[h] = demand[h]
//   (2) soc transition: soc[h] - soc[h-1] - c[h] + d[h] = 0  (soc[-1] := initial)
//   (3) neutrality: soc[23] = initial
// Objective: minimize sum over h of g[h] * tariff[h]
//
// Note on PRD §5.5 constraint 1: the PRD writes "grid + solar_used + discharge =
// demand + charge" which is exactly g + s + d - c - demand = 0. We multiply
// through to put it in row form. The PRD §5.5 constraint 7 (end-of-day
// neutrality) is "soc[23] = initial_energy_kwh" — implemented as a final row.
// We model charge/discharge as efficiency-1 (no η). The request schema does
// not carry a round-trip efficiency field, and the PRD does not require one;
// the PRD §5.5 hard constraints list "charge <= max_charge, discharge <=
// max_discharge" without an η coefficient. If a future story adds η, the
// transition row becomes soc[h] = soc[h-1] + η*c[h] - d[h]/η — a one-line
// change. Documented here so the audit can name the assumption.
export interface BuildLpArgs {
  hours: HourInput[];
  capacity_kwh: number;
  initial_energy_kwh: number;
  floors: HourFloor[]; // length 24, ascending by hour
  charge_caps: HourChargeCap[]; // length 24, ascending by hour
  grid_caps: HourGridCap[]; // length 24, ascending by hour
}

export function buildLpText(args: BuildLpArgs): string {
  const { hours, capacity_kwh, initial_energy_kwh, floors, charge_caps, grid_caps } = args;
  if (hours.length !== 24) {
    throw new Error(`build_lp: expected 24 hours, got ${hours.length}`);
  }
  if (
    floors.length !== 24 ||
    charge_caps.length !== 24 ||
    grid_caps.length !== 24
  ) {
    throw new Error("build_lp: per-hour overrides must have length 24");
  }
  // Verify ascending-by-hour for all arrays (defense; the callers should already guarantee this).
  for (let h = 1; h < 24; h++) {
    if (
      hours[h].hour !== h ||
      floors[h].hour !== h ||
      charge_caps[h].hour !== h ||
      grid_caps[h].hour !== h
    ) {
      throw new Error(`build_lp: hours/overrides must be sorted ascending by hour; off at index ${h}`);
    }
  }

  const lines: string[] = [];

  // Objective: minimize sum grid[h] * tariff[h].
  const objTerms: string[] = [];
  for (let h = 0; h < 24; h++) {
    const tariff = hours[h].tariff_bdt_per_kwh;
    if (tariff !== 0) {
      objTerms.push(`${num(tariff)} ${varName(h, "g")}`);
    }
  }
  lines.push("Minimize");
  lines.push(` obj: ${objTerms.join(" + ") || "0"}`);

  // Subject To block.
  lines.push("Subject To");
  for (let h = 0; h < 24; h++) {
    const demand = hours[h].demand_kwh;
    // Balance: g + s + d - c = demand
    lines.push(
      ` bal${h}: ${varName(h, "g")} + ${varName(h, "s")} + ${varName(h, "d")} - ${varName(h, "c")} = ${num(demand)}`,
    );

    // SoC transition. For h=0, soc[-1] is a constant: initial_energy_kwh, so
    // soc[0] - initial - c[0] + d[0] = 0  →  soc[0] - c[0] + d[0] = initial
    // For h>0, soc[h] - soc[h-1] - c[h] + d[h] = 0.
    if (h === 0) {
      lines.push(
        ` soc0: ${varName(0, "soc")} - ${varName(0, "c")} + ${varName(0, "d")} = ${num(initial_energy_kwh)}`,
      );
    } else {
      lines.push(
        ` soc${h}: ${varName(h, "soc")} - ${varName(h - 1, "soc")} - ${varName(h, "c")} + ${varName(h, "d")} = 0`,
      );
    }
  }
  // End-of-day neutrality: soc[23] = initial_energy_kwh (PRD §5.5 #7).
  lines.push(` neutral: ${varName(23, "soc")} = ${num(initial_energy_kwh)}`);

  // Bounds: variable lower / upper.
  lines.push("Bounds");
  for (let h = 0; h < 24; h++) {
    // grid: >=0, <= max_grid_kwh (per-hour cap from grid_caps; +inf if no cap)
    lines.push(` 0 <= ${varName(h, "g")} <= ${num(grid_caps[h].max_grid_kwh)}`);
    // solar_used: 0 <= ... <= effective_solar[h]
    lines.push(` 0 <= ${varName(h, "s")} <= ${num(hours[h].effective_solar_kwh)}`);
    // charge: 0 <= ... <= max_charge_kwh (0 if a no_charge_window is active)
    lines.push(` 0 <= ${varName(h, "c")} <= ${num(charge_caps[h].max_charge_kwh)}`);
    // discharge: 0 <= ... <= max_discharge_kwh (0 if a no_discharge_window is active)
    lines.push(` 0 <= ${varName(h, "d")} <= ${num(charge_caps[h].max_discharge_kwh)}`);
    // soc: floor[h] <= soc[h] <= capacity
    lines.push(` ${num(floors[h].minimum_energy_kwh)} <= ${varName(h, "soc")} <= ${num(capacity_kwh)}`);
  }
  lines.push("End");
  return lines.join("\n");
}

// Numeric formatting for LP text. HiGHS accepts plain decimals; we keep 6
// fraction digits to preserve precision through the LP solve.
function num(n: number): string {
  if (!Number.isFinite(n)) return "1e30";
  // Round to 6 decimal places to avoid floating-point dust in the LP text.
  return n.toFixed(6);
}
