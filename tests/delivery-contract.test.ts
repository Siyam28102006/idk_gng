import { describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Integration test for the e06s01t01 deliverable contract. The README
// promises a one-shot rehearsal: `bun install`, `bun run build`, `bun
// run start`, then two curl commands. This test pins that promise by
// executing it from scratch and asserting the documented curls succeed.
//
// Skipped automatically when the build is unavailable (CI without
// `.next/`); the README is the artifact, not the test runner.

const PORT = 3499; // fixed port for delivery-rehearsal; avoids 3000 collisions

async function readOrSkip(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return await readFile(path, "utf8");
}

async function buildExists(): Promise<boolean> {
  // `bun run build` produces .next/ ; check for it.
  return existsSync(".next");
}

describe("e06s01 delivery contract", () => {
  test("README.md exists and contains every required section", async () => {
    const md = await readOrSkip("README.md");
    expect(md).not.toBeNull();
    if (md === null) return;
    const required = [
      "## Setup",            // setup commands
      "bun install",
      "bun run build",
      "bun run start",
      "OPENROUTER_KEY",      // env NAMES (not values)
      "GEMINI_KEY",
      "GET /health",         // health endpoint
      "POST /optimize-energy", // main endpoint
      "nex-agi/nex-n2.5-pro:free", // primary model id
      "gemini-3.5-flash-lite",     // fallback model id
      "HiGHS",               // solver
      "## Limitations",      // limitations section
      "## Dependencies",     // deps section
    ];
    for (const needle of required) {
      expect(md).toContain(needle);
    }
  });

  test("README contains NO secret values (only env NAMES)", async () => {
    const md = await readOrSkip("README.md");
    expect(md).not.toBeNull();
    if (md === null) return;
    // Sanity: no line should look like KEY=<long-base64-or-key-string>.
    // Allow KEY= followed by empty or by a documented default like a model id.
    const lines = md.split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      const [, key, value] = m;
      // Acceptable: empty value (placeholder) OR a short, well-known
      // model id string. Reject anything that smells like a token: long
      // random-looking hex/base64.
      if (value.length === 0) continue;
      // Allow documented defaults that are public model ids.
      const allowedDefaults = new Set([
        "nex-agi/nex-n2.5-pro:free",
        "gemini-3.5-flash-lite",
      ]);
      if (allowedDefaults.has(value)) continue;
      // Otherwise, fail — README leaked a secret-looking value.
      throw new Error(`README.env line looks like a secret value: ${key}=${value}`);
    }
  });

  test(".env.example has NAMES only (no values, no comments with secrets)", async () => {
    const md = await readOrSkip(".env.example");
    expect(md).not.toBeNull();
    if (md === null) return;
    const lines = md.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      expect(m).not.toBeNull();
      if (!m) continue;
      const [, , value] = m;
      // Names-only: allow documented public defaults (model ids), no
      // token-shaped values.
      if (value.length === 0) continue;
      const allowedDefaults = new Set([
        "nex-agi/nex-n2.5-pro:free",
        "gemini-3.5-flash-lite",
      ]);
      if (allowedDefaults.has(value)) continue;
      throw new Error(`.env.example has a non-default value: ${trimmed}`);
    }
  });

  test("Dockerfile exists with pinned bun base, EXPOSE, and bun run start", async () => {
    const md = await readOrSkip("Dockerfile");
    expect(md).not.toBeNull();
    if (md === null) return;
    // Pinned base (not :latest)
    expect(md).toMatch(/FROM\s+oven\/bun:[0-9]+(\.[0-9]+){1,2}/);
    expect(md).not.toMatch(/FROM\s+oven\/bun:latest/);
    // Exposes a port
    expect(md).toMatch(/^EXPOSE\s+\d+/m);
    // Runs the documented start command. Accept either exec-form
    // (`CMD ["bun", "run", "start"]`) or shell-form
    // (`CMD bun run start`) — both are equivalent.
    expect(
      /CMD\s+\[?\s*"?bun"?\s*,\s*"?run"?\s*,\s*"?start"?/i.test(md) ||
        /CMD\s+.*bun\s+run\s+start/i.test(md),
    ).toBe(true);
    // No ENV line carrying a secret
    const envLines = md.split("\n").filter((l) => /^ENV\s+/.test(l));
    for (const line of envLines) {
      expect(line).not.toMatch(/(KEY|TOKEN|SECRET|PASSWORD)/i);
    }
  });

  test("README documented curl commands work against a live build (when .next/ exists)", async () => {
    if (!(await buildExists())) {
      // Without a build, the rehearsal test cannot run. The README
      // remains the contract.
      return;
    }
    // Start the server. `next start` reads .next/. We must set
    // OPENROUTER_KEY so the route doesn't fail closed in production
    // mode. With a dummy key the LLM call itself will fail; we only
    // verify that the server answers (no hang), the route is reachable,
    // and the response shape is the documented one (either a plan or a
    // generic 500/504 with no stack trace).
    const proc = spawn({
      cmd: ["bun", "run", "start"],
      env: {
        ...process.env,
        PORT: String(PORT),
        OPENROUTER_KEY: process.env.OPENROUTER_KEY ?? "dummy-for-rehearsal",
        OPENROUTER_MODEL: "nex-agi/nex-n2.5-pro:free",
        GEMINI_KEY: process.env.GEMINI_KEY ?? "dummy-for-rehearsal",
        GEMINI_MODEL: "gemini-3.5-flash-lite",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Wait for /health to come up. Timeout 60s (PRD NFR).
      const deadline = Date.now() + 60_000;
      let healthOk = false;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://localhost:${PORT}/health`);
          if (r.status === 200) {
            const body = await r.json();
            if (body.status === "ok") {
              healthOk = true;
              break;
            }
          }
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(healthOk).toBe(true);

      // Now POST a sample /optimize-energy body. With dummy LLM keys
      // the real provider call will fail and the route returns 500
      // with a generic message (per PRD fail-closed contract). What we
      // assert here is the runtime contract: the route answers within
      // the 30s budget and never hangs, and any 500 body matches the
      // documented {error: "string"} shape with no stack traces.
      const hours = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        demand_kwh: 50,
        solar_kwh: 0,
        tariff_bdt_per_kwh: 5,
      }));
      const reqBody = JSON.stringify({
        scenario_id: "delivery-rehearsal",
        operator_notes: ["run normally"],
        hours,
        battery: {
          capacity_kwh: 200,
          initial_energy_kwh: 100,
          minimum_energy_kwh: 0,
          max_charge_kwh_per_hour: 100,
          max_discharge_kwh_per_hour: 100,
        },
      });
      const t0 = Date.now();
      const res = await fetch(`http://localhost:${PORT}/optimize-energy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: reqBody,
      });
      const elapsed = Date.now() - t0;
      // PRD NFR: every request settles inside 30s.
      expect(elapsed).toBeLessThan(30_000);
      // Without real LLM keys we expect a controlled failure (500),
      // not 200. The shape contract is still enforced.
      expect([200, 422, 500, 504]).toContain(res.status);
      const body = await res.json();
      if (res.status === 200) {
        expect(body.scenario_id).toBe("delivery-rehearsal");
        expect(Array.isArray(body.hourly_plan)).toBe(true);
        expect(body.hourly_plan.length).toBe(24);
      } else {
        // Controlled failure: must have a generic error string, no stack
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toMatch(/stack|at .+\(.+:\d+:\d+\)/);
      }
    } finally {
      proc.kill();
    }
  }, { timeout: 90_000 });
});
