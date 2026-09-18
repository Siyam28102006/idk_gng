import { z } from "zod";

const hoursSchema = z.array(z.number().int().min(0).max(23)).min(1);

export const directiveSchema = z.discriminatedUnion("directive_type", [
  z.object({
    directive_type: z.literal("solar_reduction"),
    structured_adjustment: z.object({ hours: hoursSchema, factor: z.number().min(0).max(1) }),
  }),
  z.object({
    directive_type: z.literal("minimum_battery_reserve"),
    structured_adjustment: z.object({ hours: hoursSchema, minimum_energy_kwh: z.number().finite().nonnegative() }),
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
    structured_adjustment: z.object({ hours: hoursSchema, max_grid_kwh: z.number().finite().nonnegative() }),
  }),
  z.object({
    directive_type: z.literal("no_op"),
    structured_adjustment: z.null(),
  }),
]);

export type DirectiveCandidate = z.infer<typeof directiveSchema>;
