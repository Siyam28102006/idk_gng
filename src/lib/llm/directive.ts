import { z } from "zod";

// Hours are *type-checked* here (int, in 0..23) but ordering, uniqueness, and
// per-type bounds (factor in [0,1], reserve within capacity, grid cap >= 0)
// are owned by the guardrail validator — the single source of truth.
const hoursSchema = z.array(z.number().int().min(0).max(23)).min(1);

export const directiveSchema = z.discriminatedUnion("directive_type", [
  z.object({
    directive_type: z.literal("solar_reduction"),
    structured_adjustment: z.object({ hours: hoursSchema, factor: z.number().finite() }),
  }),
  z.object({
    directive_type: z.literal("minimum_battery_reserve"),
    structured_adjustment: z.object({ hours: hoursSchema, minimum_energy_kwh: z.number().finite() }),
  }),
  z.object({
    directive_type: z.literal("no_charge_window"),
    structured_adjustment: z.object({ hours: hoursSchema }),
  }),
  z.object({
    directive_type: z.literal("no_discharge_window"),
    structured_adjustment: z.object({ hours: hoursSchema }),
  }),
  z.object({
    directive_type: z.literal("max_grid_window"),
    structured_adjustment: z.object({ hours: hoursSchema, max_grid_kwh: z.number().finite() }),
  }),
  z.object({
    directive_type: z.literal("no_op"),
    structured_adjustment: z.null(),
  }),
]);

export type DirectiveCandidate = z.infer<typeof directiveSchema>;

export interface BatteryContext {
  capacity_kwh: number;
  initial_energy_kwh: number;
  minimum_energy_kwh: number;
  max_charge_kwh_per_hour: number;
  max_discharge_kwh_per_hour: number;
}
