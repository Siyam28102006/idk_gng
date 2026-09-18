import { describe, expect, test } from "bun:test";
import { directiveSchema } from "../src/lib/llm/directive";
import { buildPrompt } from "../src/lib/llm/prompt";
import { interpretNotes, AiLlmClient, LlmError, configuredProviders, hasLlmKeys } from "../src/lib/llm/interpret";

const battery = {
  capacity_kwh: 200,
  initial_energy_kwh: 100,
  minimum_energy_kwh: 20,
  max_charge_kwh_per_hour: 50,
  max_discharge_kwh_per_hour: 50,
};

describe("directiveSchema", () => {
  test("accepts one fixture per each of the six types", () => {
    const fixtures = [
      { directive_type: "solar_reduction", structured_adjustment: { hours: [13, 14], factor: 0.2 } },
      { directive_type: "minimum_battery_reserve", structured_adjustment: { hours: [18, 19], minimum_energy_kwh: 100 } },
      { directive_type: "no_charge_window", structured_adjustment: { hours: [2, 3, 4] } },
      { directive_type: "no_discharge_window", structured_adjustment: { hours: [18, 19] } },
      { directive_type: "max_grid_window", structured_adjustment: { hours: [18, 19, 20], max_grid_kwh: 155 } },
      { directive_type: "no_op", structured_adjustment: null },
    ];
    for (const f of fixtures) {
      expect(directiveSchema.safeParse(f).success).toBe(true);
    }
  });
  test("rejects a seventh type and mismatched adjustment shapes", () => {
    expect(
      directiveSchema.safeParse({ directive_type: "shift_demand", structured_adjustment: { hours: [1] } }).success,
    ).toBe(false);
    expect(
      directiveSchema.safeParse({ directive_type: "solar_reduction", structured_adjustment: { hours: [1] } }).success,
    ).toBe(false);
    expect(
      directiveSchema.safeParse({ directive_type: "no_op", structured_adjustment: { hours: [1] } }).success,
    ).toBe(false);
  });
});

describe("configuredProviders", () => {
  test("orders openrouter before google", () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders({ GEMINI_KEY: "x" })).toEqual(["google"]);
    expect(configuredProviders({ OPENROUTER_KEY: "x" })).toEqual(["openrouter"]);
    expect(configuredProviders({ OPENROUTER_KEY: "x", GEMINI_KEY: "y" })).toEqual([
      "openrouter",
      "google",
    ]);
    expect(hasLlmKeys({})).toBe(false);
    expect(hasLlmKeys({ OPENROUTER_KEY: "x" })).toBe(true);
    expect(hasLlmKeys({ LLM_API_KEY: "x", LLM_FALLBACK_API_KEY: "y" })).toBe(true);
  });
});

describe("interpretNotes", () => {
  test("preserves note order across parallel calls", async () => {
    const byNote = (prompt: string) => {
      if (prompt.includes("first note")) return { directive_type: "solar_reduction", structured_adjustment: { hours: [5], factor: 0.5 } };
      if (prompt.includes("second note")) return { directive_type: "no_charge_window", structured_adjustment: { hours: [2] } };
      return { directive_type: "no_op", structured_adjustment: null };
    };
    const client = {
      generate: async (prompt: string) => {
        const delay = prompt.includes("first note") ? 30 : 0;
        await new Promise((r) => setTimeout(r, delay));
        return byNote(prompt);
      },
    };
    const out = await interpretNotes(["first note", "second note", "third note"], battery, client);
    expect(out.map((c) => c.directive_type)).toEqual(["solar_reduction", "no_charge_window", "no_op"]);
    expect(out[0].structured_adjustment).toEqual({ hours: [5], factor: 0.5 });
  });
  test("maps invalid candidates and client failures to LlmError", async () => {
    const badClient = { generate: async () => ({ directive_type: "shift_demand" }) };
    await expect(interpretNotes(["x"], battery, badClient)).rejects.toBeInstanceOf(LlmError);
    const failingClient = {
      generate: async () => { throw new Error("provider down"); },
    };
    await expect(interpretNotes(["x"], battery, failingClient)).rejects.toBeInstanceOf(LlmError);
  });
  test("labels aborts as timeout and bounds hanging clients", async () => {
    const aborting = {
      generate: async () => { throw new DOMException("aborted", "AbortError"); },
    };
    await expect(interpretNotes(["x"], battery, aborting)).rejects.toMatchObject({ kind: "timeout" });
    const hanging = { generate: () => new Promise(() => {}) };
    await expect(interpretNotes(["x"], battery, hanging, { noteMs: 50 })).rejects.toMatchObject({ kind: "timeout" });
  });
  test("fails closed in production with no keys, stubs outside it", async () => {
    const names = ["OPENROUTER_KEY", "OPENROUTER_MODEL", "GEMINI_KEY", "GEMINI_MODEL", "LLM_API_KEY", "LLM_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_MODEL"];
    const saved: Record<string, string | undefined> = {};
    const savedEnv = process.env.NODE_ENV;
    try {
      for (const name of names) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
      process.env.NODE_ENV = "production";
      await expect(interpretNotes(["x"], battery)).rejects.toBeInstanceOf(LlmError);
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
    }
  });
});

describe("AiLlmClient fallback", () => {
  const candidate = { directive_type: "no_op", structured_adjustment: null };
  test("builds env runners and surfaces provider failure", async () => {
    const saved = { ...process.env };
    try {
      process.env.OPENROUTER_KEY = "dummy";
      process.env.GEMINI_KEY = "dummy";
      await expect(new AiLlmClient().generate("x")).rejects.toThrow();
    } finally {
      process.env = saved;
    }
  });
  test("tries runners in order and throws the last error", async () => {
    const seen: string[] = [];
    const failThenSucceed = new AiLlmClient([
      { name: "openrouter", run: async () => { seen.push("openrouter"); throw new Error("down"); } },
      { name: "google", run: async () => { seen.push("google"); return candidate; } },
    ]);
    const out = await interpretNotes(["x"], battery, failThenSucceed);
    expect(seen).toEqual(["openrouter", "google"]);
    expect(out[0].directive_type).toBe("no_op");
    const bothFail = new AiLlmClient([
      { name: "openrouter", run: async () => { throw new Error("down1"); } },
      { name: "google", run: async () => { throw new Error("down2"); } },
    ]);
    await expect(interpretNotes(["x"], battery, bothFail)).rejects.toBeInstanceOf(LlmError);
  });
});

describe("buildPrompt", () => {
  test("embeds six types, battery capacity, and no_op guidance", () => {
    const prompt = buildPrompt("Panel washing 1-3 PM.", battery);
    for (const t of ["solar_reduction", "minimum_battery_reserve", "no_charge_window", "no_discharge_window", "max_grid_window", "no_op"]) {
      expect(prompt).toContain(t);
    }
    expect(prompt).toContain("200");
    expect(prompt).toContain("Panel washing 1-3 PM.");
    expect(prompt).toContain("untrusted");
  });
});
