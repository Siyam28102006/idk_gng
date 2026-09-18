import { directiveSchema, type BatteryContext } from "@/lib/llm/directive";
import type {
  FallbackReason,
  GuardrailResult,
  ValidatedDirective,
} from "./types";

function flaggedNoOp(noteIndex: number, reason: FallbackReason): {
  directive: ValidatedDirective;
  reason: { note_index: number; reason: FallbackReason };
} {
  return {
    directive: {
      note_index: noteIndex,
      directive_type: "no_op",
      applies: false,
      structured_adjustment: null,
    },
    reason: { note_index: noteIndex, reason },
  };
}

function normalizeHours(
  hours: readonly number[],
): { ok: true; hours: number[] } | { ok: false; reason: FallbackReason } {
  if (hours.length === 0) return { ok: false, reason: "shape_invalid" };
  const set = new Set(hours);
  if (set.size !== hours.length) {
    return { ok: false, reason: "hours_duplicated" };
  }
  for (let i = 1; i < hours.length; i++) {
    if (hours[i]! <= hours[i - 1]!) {
      return { ok: false, reason: "hours_unsorted" };
    }
  }
  return { ok: true, hours: [...hours] };
}

function hoursCheck<T extends { hours: readonly number[] }>(
  adj: T,
): { ok: true; adj: T } | { ok: false; reason: FallbackReason } {
  const h = normalizeHours(adj.hours);
  if (!h.ok) return { ok: false, reason: h.reason };
  return { ok: true, adj: { ...adj, hours: h.hours } as T };
}

function validateOne(
  candidate: unknown,
  noteIndex: number,
  battery: BatteryContext,
):
  | { ok: true; directive: ValidatedDirective }
  | { ok: false; directive: ValidatedDirective; reason: { note_index: number; reason: FallbackReason } } {
  const parsed = directiveSchema.safeParse(candidate);
  if (!parsed.success) {
    const r = flaggedNoOp(noteIndex, "shape_invalid");
    return { ok: false, directive: r.directive, reason: r.reason };
  }
  const c = parsed.data;
  const applies = c.directive_type !== "no_op";

  // Per-type shape and bounds checks. Each branch keeps the structured_adjustment
  // narrowed to its own shape so TypeScript can verify property access.
  switch (c.directive_type) {
    case "solar_reduction": {
      const adj = c.structured_adjustment;
      if (!Number.isFinite(adj.factor) || adj.factor < 0 || adj.factor > 1) {
        const r = flaggedNoOp(noteIndex, "factor_out_of_range");
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      const h = hoursCheck(adj);
      if (!h.ok) {
        const r = flaggedNoOp(noteIndex, h.reason);
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      return {
        ok: true,
        directive: {
          note_index: noteIndex,
          directive_type: c.directive_type,
          applies,
          structured_adjustment: h.adj,
        },
      };
    }
    case "minimum_battery_reserve": {
      const adj = c.structured_adjustment;
      if (!Number.isFinite(adj.minimum_energy_kwh) || adj.minimum_energy_kwh < 0 || adj.minimum_energy_kwh > battery.capacity_kwh) {
        const r = flaggedNoOp(noteIndex, "reserve_out_of_bounds");
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      const h = hoursCheck(adj);
      if (!h.ok) {
        const r = flaggedNoOp(noteIndex, h.reason);
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      return {
        ok: true,
        directive: {
          note_index: noteIndex,
          directive_type: c.directive_type,
          applies,
          structured_adjustment: h.adj,
        },
      };
    }
    case "no_charge_window":
    case "no_discharge_window": {
      const h = hoursCheck(c.structured_adjustment);
      if (!h.ok) {
        const r = flaggedNoOp(noteIndex, h.reason);
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      return {
        ok: true,
        directive: {
          note_index: noteIndex,
          directive_type: c.directive_type,
          applies,
          structured_adjustment: h.adj,
        },
      };
    }
    case "max_grid_window": {
      const adj = c.structured_adjustment;
      if (!Number.isFinite(adj.max_grid_kwh) || adj.max_grid_kwh < 0) {
        const r = flaggedNoOp(noteIndex, "cap_negative");
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      const h = hoursCheck(adj);
      if (!h.ok) {
        const r = flaggedNoOp(noteIndex, h.reason);
        return { ok: false, directive: r.directive, reason: r.reason };
      }
      return {
        ok: true,
        directive: {
          note_index: noteIndex,
          directive_type: c.directive_type,
          applies,
          structured_adjustment: h.adj,
        },
      };
    }
    case "no_op": {
      return {
        ok: true,
        directive: {
          note_index: noteIndex,
          directive_type: "no_op",
          applies: false,
          structured_adjustment: null,
        },
      };
    }
  }
}

export function validateGuardrails(
  candidates: readonly unknown[],
  notes: readonly string[],
  battery: BatteryContext,
): GuardrailResult {
  const directives: ValidatedDirective[] = [];
  const fallback_reasons: Array<{ note_index: number; reason: FallbackReason }> = [];

  for (let i = 0; i < notes.length; i++) {
    const candidate = candidates[i];
    if (candidate === undefined) {
      const r = flaggedNoOp(i, "candidates_missing");
      directives.push(r.directive);
      fallback_reasons.push(r.reason);
      continue;
    }

    const result = validateOne(candidate, i, battery);
    if (result.ok) {
      directives.push(result.directive);
    } else {
      directives.push(result.directive);
      fallback_reasons.push(result.reason);
    }
  }

  return { directives, fallback_reasons };
}
