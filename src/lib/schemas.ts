import { z } from "zod";

const hourSchema = z.object({
  hour: z.number().int().min(0).max(23),
  demand_kwh: z.number().finite().nonnegative(),
  solar_kwh: z.number().finite().nonnegative(),
  tariff_bdt_per_kwh: z.number().finite().nonnegative(),
});

const batterySchema = z.object({
  capacity_kwh: z.number().finite().positive(),
  initial_energy_kwh: z.number().finite().nonnegative(),
  minimum_energy_kwh: z.number().finite().nonnegative(),
  max_charge_kwh_per_hour: z.number().finite().nonnegative(),
  max_discharge_kwh_per_hour: z.number().finite().nonnegative(),
});

export const optimizeRequestSchema = z
  .object({
    scenario_id: z.string().min(1),
    operator_notes: z.array(z.string().min(1)).min(1).max(3),
    hours: z.array(hourSchema).length(24),
    battery: batterySchema,
  })
  .refine(
    (req) => {
      const hs = req.hours.map((h) => h.hour);
      return new Set(hs).size === 24 && hs.every((h, i) => h === i);
    },
    { message: "hours must cover 0-23 exactly once" },
  );

export type OptimizeRequest = z.infer<typeof optimizeRequestSchema>;
