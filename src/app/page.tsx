import Link from "next/link";

const endpoints = [
  {
    method: "GET",
    path: "/health",
    description: "Liveness probe. Returns 200 {\"status\":\"ok\"} within 60s of cold start.",
  },
  {
    method: "POST",
    path: "/optimize-energy",
    description:
      "Interpret 1–3 operator notes, validate, and return a 24h dispatch plan. <30s, target p95 ≤5s.",
  },
];

const sampleBody = `{
  "scenario_id": "tracer-01",
  "operator_notes": [
    "PV output drops to 20% between 13:00 and 15:00."
  ],
  "hours": [ /* 24 entries: hour, demand_kwh, solar_kwh, tariff_bdt_per_kwh */ ],
  "battery": {
    "capacity_kwh": 200,
    "initial_energy_kwh": 100,
    "minimum_energy_kwh": 20,
    "max_charge_kwh_per_hour": 50,
    "max_discharge_kwh_per_hour": 50
  }
}`;

export default function Home() {
  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-3">
        <span className="text-xs uppercase tracking-[0.2em] text-telemetry-grid">
          BUP CSE Fest 2026
        </span>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-zinc-50">
          GridWise
        </h1>
        <p className="max-w-2xl text-base leading-7 text-zinc-400">
          LLM-assisted Smart Campus Energy Optimization. One operator note in,
          one deterministic 24-hour dispatch plan out — interpreted by an LLM,
          guarded by deterministic rules, solved by an LP/MILP optimizer, and
          re-validated hour by hour.
        </p>
      </header>

      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        {endpoints.map((e) => (
          <article
            key={e.path}
            className="rounded-xl border border-border-soft bg-card p-6"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-medium text-telemetry-grid">
                {e.method}
              </span>
              <code className="font-mono text-sm text-zinc-200 tabular-nums">
                {e.path}
              </code>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-400">{e.description}</p>
          </article>
        ))}
      </section>

      <section className="mt-12 rounded-xl border border-border-soft bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Sample request
          </h2>
          <span className="font-mono text-xs text-zinc-500">POST /optimize-energy</span>
        </div>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-raised p-4 font-mono text-xs leading-5 text-zinc-200 tabular-nums">
{sampleBody}
        </pre>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/api/optimize-energy"
            className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm text-zinc-200 transition-colors hover:border-telemetry-grid hover:text-telemetry-grid"
          >
            See API contract
          </Link>
          <Link
            href="/health"
            className="inline-flex h-10 items-center rounded-lg bg-telemetry-grid px-4 text-sm font-medium text-canvas transition-opacity hover:opacity-90"
          >
            GET /health →
          </Link>
        </div>
      </section>

      <footer className="mt-16 flex items-center justify-between border-t border-border-soft pt-6 text-xs text-zinc-500">
        <span>Single public HTTP service · no auth · scored API</span>
        <span className="font-mono tabular-nums">Next.js 16.3.5 · React 19 · Tailwind v4</span>
      </footer>
    </main>
  );
}
