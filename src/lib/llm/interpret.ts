import { generateText, Output } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { directiveSchema, type BatteryContext, type DirectiveCandidate } from "./directive";
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
  generate(prompt: string): Promise<unknown>;
}

export const DEFAULT_OPENROUTER_MODEL = "nex-agi/nex-n2.5-pro:free";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
export const ATTEMPT_TIMEOUT_MS = 9_000;
export const NOTE_TIMEOUT_MS = 20_000;

export type ProviderName = "openrouter" | "google";

// Canonical names are OPENROUTER_*/GEMINI_*; LLM_API_KEY / LLM_MODEL /
// LLM_FALLBACK_API_KEY / LLM_FALLBACK_MODEL are accepted as legacy aliases
// so older .env.local files keep working.
function pick(env: Record<string, string | undefined>, ...names: string[]): string | undefined {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return undefined;
}

export function configuredProviders(env: Record<string, string | undefined> = process.env): ProviderName[] {
  const names: ProviderName[] = [];
  if (pick(env, "OPENROUTER_KEY", "LLM_API_KEY")) names.push("openrouter");
  if (pick(env, "GEMINI_KEY", "LLM_FALLBACK_API_KEY")) names.push("google");
  return names;
}

export interface AttemptRunner {
  name: string;
  run(prompt: string, signal: AbortSignal): Promise<unknown>;
}

// Exported as a documented test seam: unit tests inject scripted runners so
// the fallback sequence is covered without keys, network, or quota.
export class AiLlmClient implements LlmClient {
  constructor(private runners?: AttemptRunner[]) {}

  private buildRunners(env: Record<string, string | undefined> = process.env): AttemptRunner[] {
    if (this.runners) return this.runners;
    const run = (model: Parameters<typeof generateText>[0]["model"]) => (prompt: string, signal: AbortSignal) =>
      generateText({ model, output: Output.object({ schema: directiveSchema }), prompt, abortSignal: signal }).then(
        (r) => r.output,
      );
    // Order defined once by configuredProviders; each name builds its runner.
    return configuredProviders(env).flatMap((name): AttemptRunner[] => {
      if (name === "openrouter" && pick(env, "OPENROUTER_KEY", "LLM_API_KEY")) {
        const openrouter = createOpenAICompatible({
          name: "openrouter",
          apiKey: pick(env, "OPENROUTER_KEY", "LLM_API_KEY") as string,
          baseURL: "https://openrouter.ai/api/v1",
          // Verified live against nex-agi/nex-n2.5-pro:free: strict json_schema
          // accepted, so the schema is enforced server-side, not just client-side.
          supportsStructuredOutputs: true,
        });
        const modelId = pick(env, "OPENROUTER_MODEL", "LLM_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
        return [{ name, run: run(openrouter(modelId)) }];
      }
      if (name === "google" && pick(env, "GEMINI_KEY", "LLM_FALLBACK_API_KEY")) {
        const google = createGoogle({ apiKey: pick(env, "GEMINI_KEY", "LLM_FALLBACK_API_KEY") as string });
        const modelId = pick(env, "GEMINI_MODEL", "LLM_FALLBACK_MODEL") ?? DEFAULT_GOOGLE_MODEL;
        return [{ name, run: run(google(modelId)) }];
      }
      return [];
    });
  }

  async generate(prompt: string): Promise<unknown> {
    // Each attempt gets a fresh deadline so a slow failure cannot starve the fallback.
    const runners = this.buildRunners();
    let lastError: unknown = new Error("no LLM provider configured");
    for (const runner of runners) {
      try {
        return await runner.run(prompt, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS));
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}

// Deterministic double used ONLY when no LLM keys are configured
// (local tests). The deployed service always sets keys, so judging traffic
// always takes the real LLM path above.
class StubLlmClient implements LlmClient {
  constructor(private failClosed = false) {}
  async generate(): Promise<unknown> {
    if (this.failClosed) {
      throw new LlmError("provider", "LLM not configured");
    }
    return { directive_type: "no_op", structured_adjustment: null };
  }
}

export function hasLlmKeys(env: Record<string, string | undefined> = process.env): boolean {
  return configuredProviders(env).length > 0;
}

export function defaultClient(): LlmClient {
  if (!hasLlmKeys()) {
    if (process.env.NODE_ENV === "production") {
      console.error("No LLM keys set in production: failing closed.");
      return new StubLlmClient(true);
    }
    console.warn("No LLM keys set: using deterministic test double (no_op per note).");
    return new StubLlmClient();
  }
  return new AiLlmClient();
}

function withNoteTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmError("timeout", "LLM call timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new LlmError("timeout", "LLM call timed out");
  }
  return new LlmError("provider", "LLM provider failed");
}

export async function interpretNotes(
  notes: string[],
  battery: BatteryContext,
  client: LlmClient = defaultClient(),
  timeouts: { noteMs: number } = { noteMs: NOTE_TIMEOUT_MS },
): Promise<DirectiveCandidate[]> {
  return Promise.all(
    notes.map(async (note) => {
      let raw: unknown;
      try {
        raw = await withNoteTimeout(client.generate(buildPrompt(note, battery)), timeouts.noteMs);
      } catch (e) {
        throw toLlmError(e);
      }
      const parsed = directiveSchema.safeParse(raw);
      if (!parsed.success) {
        throw new LlmError("validation", "LLM output failed schema validation");
      }
      return parsed.data;
    }),
  );
}
