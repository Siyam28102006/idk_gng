import { generateText, Output } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { directiveSchema, type DirectiveCandidate } from "./directive";
import { buildPrompt } from "./prompt";

export type LlmErrorKind = "timeout" | "validation" | "provider";

export class LlmError extends Error {
  kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface LlmClient {
  generate(prompt: string, signal: AbortSignal): Promise<unknown>;
}

const CALL_TIMEOUT_MS = 10_000;

class AiLlmClient implements LlmClient {
  async generate(prompt: string, signal: AbortSignal): Promise<unknown> {
    const attempts: Array<() => Promise<unknown>> = [];
    if (process.env.LLM_API_KEY) {
      const groq = createGroq({ apiKey: process.env.LLM_API_KEY });
      const model = groq(process.env.LLM_MODEL ?? "llama-3.3-70b-versatile");
      attempts.push(() =>
        generateText({ model, output: Output.object({ schema: directiveSchema }), prompt, abortSignal: signal }).then(
          (r) => r.output,
        ),
      );
    }
    if (process.env.LLM_FALLBACK_API_KEY) {
      const google = createGoogle({ apiKey: process.env.LLM_FALLBACK_API_KEY });
      const model = google(process.env.LLM_FALLBACK_MODEL ?? "gemini-3.5-flash-lite");
      attempts.push(() =>
        generateText({ model, output: Output.object({ schema: directiveSchema }), prompt, abortSignal: signal }).then(
          (r) => r.output,
        ),
      );
    }
    let lastError: unknown = new Error("no LLM provider configured");
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}

// Deterministic double used ONLY when no LLM_API_KEY is configured
// (local tests). The deployed service always sets keys, so judging traffic
// always takes the real LLM path above.
class StubLlmClient implements LlmClient {
  async generate(): Promise<unknown> {
    return { directive_type: "no_op", structured_adjustment: null };
  }
}

export function defaultClient(): LlmClient {
  if (!process.env.LLM_API_KEY && !process.env.LLM_FALLBACK_API_KEY) {
    console.warn("No LLM keys set: using deterministic test double (no_op per note).");
    return new StubLlmClient();
  }
  return new AiLlmClient();
}

interface BatteryContext {
  capacity_kwh: number;
  initial_energy_kwh: number;
  minimum_energy_kwh: number;
  max_charge_kwh_per_hour: number;
  max_discharge_kwh_per_hour: number;
}

export async function interpretNotes(
  notes: string[],
  battery: BatteryContext,
  client: LlmClient = defaultClient(),
): Promise<DirectiveCandidate[]> {
  return Promise.all(
    notes.map(async (note) => {
      const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
      let raw: unknown;
      try {
        raw = await client.generate(buildPrompt(note, battery), signal);
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError") {
          throw new LlmError("timeout", "LLM call timed out");
        }
        throw new LlmError("provider", "LLM provider failed");
      }
      const parsed = directiveSchema.safeParse(raw);
      if (!parsed.success) {
        throw new LlmError("validation", "LLM output failed schema validation");
      }
      return parsed.data;
    }),
  );
}
