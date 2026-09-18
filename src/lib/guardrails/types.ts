import type { directiveSchema } from "@/lib/llm/directive";

export type DirectiveCandidate = (typeof directiveSchema)["_input"];

export interface ValidatedDirective {
  note_index: number;
  directive_type: DirectiveCandidate["directive_type"];
  applies: boolean;
  structured_adjustment: DirectiveCandidate["structured_adjustment"];
}

export type FallbackReason =
  | "hours_unsorted"
  | "hours_duplicated"
  | "factor_out_of_range"
  | "reserve_out_of_bounds"
  | "cap_negative"
  | "note_index_gap"
  | "shape_invalid"
  | "shape_mismatch"
  | "candidates_missing";

export interface GuardrailResult {
  directives: ValidatedDirective[];
  fallback_reasons: Array<{ note_index: number; reason: FallbackReason }>;
}
