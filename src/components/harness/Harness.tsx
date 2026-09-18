"use client";

import { useMemo, useState } from "react";
import { TopBar, type View } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { BatteryConfig, type BatteryFields } from "./BatteryConfig";
import { ScenarioMatrix } from "./ScenarioMatrix";
import { OperatorDirectives } from "./OperatorDirectives";
import { BottomBar } from "./BottomBar";
import { MetricTiles } from "./MetricTiles";
import { DirectiveInterpretation, type DirectiveCard } from "./DirectiveInterpretation";
import { DispatchPlan, type DispatchHour } from "./DispatchPlan";
import { sampleEnvelope } from "@/lib/ui/sample-data";

// Top-level client component that orchestrates the local UI harness.
// Two views share a single set of inputs:
//
//   Scenario Builder — Battery Config | Scenario Matrix | Operator Directives
//   Optimization Results — Metric Tiles | Directive Interpretation | Dispatch Plan
//
// The harness posts to /optimize-energy. Until a successful run is in
// hand the Results view is gated (top-bar tab is disabled).

type RunStatus = "idle" | "running" | "complete" | "error";

interface OptimizeResponse {
  scenario_id: string;
  directive_interpretation: DirectiveCard[];
  hourly_plan: DispatchHour[];
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
  plan_summary: string;
}

export function Harness() {
  const envelope = useMemo(() => sampleEnvelope(), []);
  const [view, setView] = useState<View>("scenario");
  const [battery, setBattery] = useState<BatteryFields>(envelope.battery);
  const [notes, setNotes] = useState<string[]>(envelope.operator_notes);
  const [scenarioId, setScenarioId] = useState<string>(envelope.scenario_id);
  const [hours, setHours] = useState(envelope.hours);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const [status, setStatus] = useState<RunStatus>("idle");
  const [apiStatus, setApiStatus] = useState<string>("Ready · next: POST /optimize-energy");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<OptimizeResponse | null>(null);

  function onQuickFill() {
    const env = sampleEnvelope();
    setBattery(env.battery);
    setNotes(env.operator_notes);
    setScenarioId(env.scenario_id);
    setHours(env.hours);
  }

  function onImportCsv() {
    // Stub: harness does not parse CSV yet. Reset to sample envelope
    // so the operator sees a familiar shape and can iterate.
    onQuickFill();
  }

  function onValidateJson() {
    const body = buildBody();
    const json = JSON.stringify(body, null, 2);
    // Quick shape check — same schema the server enforces.
    if (!Array.isArray(body.hours) || body.hours.length !== 24) {
      setError("Hours array must have exactly 24 entries.");
      return;
    }
    if (body.battery.minimum_energy_kwh > body.battery.capacity_kwh) {
      setError("Minimum energy exceeds capacity.");
      return;
    }
    setError(null);
    setApiStatus(`JSON valid · ${json.length} bytes · ready to POST`);
  }

  function onReset() {
    setView("scenario");
    setStatus("idle");
    setError(null);
    setResponse(null);
    setApiStatus("Ready · next: POST /optimize-energy");
    onQuickFill();
  }

  async function onRun() {
    setStatus("running");
    setError(null);
    setApiStatus("POST /optimize-energy …");
    try {
      const res = await fetch("/optimize-energy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const text = await res.text();
      const body: unknown = text ? JSON.parse(text) : {};
      if (res.status === 200) {
        setResponse(body as OptimizeResponse);
        setStatus("complete");
        setApiStatus(`200 OK · ${res.headers.get("content-type") ?? "application/json"} · ${
          (body as OptimizeResponse).hourly_plan.length
        }h plan`);
        setView("results");
      } else {
        setStatus("error");
        const errMsg =
          typeof (body as { error?: string }).error === "string"
            ? (body as { error: string }).error
            : `HTTP ${res.status}`;
        setApiStatus(`${res.status} · ${errMsg}`);
        setError(errMsg);
      }
    } catch (e) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : "unknown error";
      setApiStatus(`Network error · ${msg}`);
      setError(msg);
    }
  }

  function buildBody() {
    return {
      scenario_id: scenarioId,
      operator_notes: notes.filter((n) => n.trim().length > 0),
      hours,
      battery,
    };
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar view={view} onView={setView} status={status} />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 px-6 py-6">
          {view === "scenario" ? (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
              <BatteryConfig value={battery} onChange={setBattery} />
              <ScenarioMatrix
                hours={hours}
                onSelectHour={setSelectedHour}
                selectedHour={selectedHour}
              />
              <OperatorDirectives notes={notes} onChange={setNotes} />
            </div>
          ) : (
            <div className="space-y-6">
              {response ? (
                <>
                  <Banner scenarioId={response.scenario_id} summary={response.plan_summary} />
                  <MetricTiles
                    totalGridKwh={response.total_grid_kwh}
                    totalCostBdt={response.total_cost_bdt}
                    peakGridKwh={response.peak_grid_kwh}
                  />
                  <DirectiveInterpretation cards={response.directive_interpretation} />
                  <DispatchPlan hours={response.hourly_plan} capacityKwh={battery.capacity_kwh} />
                  <ExecutiveSummary
                    hours={response.hourly_plan}
                    directives={response.directive_interpretation}
                  />
                </>
              ) : (
                <EmptyResults onBack={() => setView("scenario")} />
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-md border border-telemetry-fault/40 bg-telemetry-fault/10 px-3 py-2 font-mono text-xs text-telemetry-fault">
              {error}
            </p>
          )}
        </main>
      </div>

      <BottomBar
        scenarioId={scenarioId}
        onScenarioId={setScenarioId}
        apiStatus={apiStatus}
        onQuickFill={onQuickFill}
        onImportCsv={onImportCsv}
        onValidateJson={onValidateJson}
        onReset={onReset}
        onRun={onRun}
        isRunning={status === "running"}
        isComplete={status === "complete"}
      />

      <PageFooter />
    </div>
  );
}

function Banner({ scenarioId, summary }: { scenarioId: string; summary: string }) {
  return (
    <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-emerald-400">
          Optimization Run Complete
        </h2>
        <span className="rounded border border-emerald-500/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
          {scenarioId}
        </span>
      </div>
      <p className="mt-2 text-sm text-emerald-200/80">{summary}</p>
    </section>
  );
}

function ExecutiveSummary({
  hours,
  directives,
}: {
  hours: DispatchHour[];
  directives: DirectiveCard[];
}) {
  const charge = hours.filter((h) => h.battery_action === "charge").length;
  const discharge = hours.filter((h) => h.battery_action === "discharge").length;
  const idle = hours.filter((h) => h.battery_action === "idle").length;
  const applied = directives.filter((d) => d.applies && d.directive_type !== "no_op").length;
  const noOps = directives.filter((d) => d.directive_type === "no_op").length;

  return (
    <section className="rounded-xl border border-border-soft bg-card p-5">
      <h2 className="font-semibold text-zinc-50">Executive Dispatch Summary</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-5">
        <Stat label="Charge Hours" value={charge.toString()} accent="text-telemetry-battery" />
        <Stat label="Discharge Hours" value={discharge.toString()} accent="text-cyan-400" />
        <Stat label="Idle Hours" value={idle.toString()} accent="text-slate-400" />
        <Stat label="Directives Applied" value={applied.toString()} accent="text-emerald-400" />
        <Stat label="No-Op Notes" value={noOps.toString()} accent="text-slate-400" />
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-raised p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={"mt-1 font-mono text-2xl font-semibold tabular-nums " + accent}>
        {value}
      </p>
    </div>
  );
}

function EmptyResults({ onBack }: { onBack: () => void }) {
  return (
    <section className="rounded-xl border border-border-soft bg-card p-8 text-center">
      <h2 className="text-lg font-semibold text-zinc-50">No optimization results yet</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Configure the scenario, then click <span className="font-mono">Run Optimization</span>.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 rounded-md border border-border-strong px-4 py-2 text-xs text-zinc-300 hover:border-telemetry-grid hover:text-telemetry-grid"
      >
        ← Back to Scenario Builder
      </button>
    </section>
  );
}

function PageFooter() {
  return (
    <footer className="border-t border-border-soft bg-card px-6 py-3">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <span>MILP Substation · HiGHS LP · WebAssembly</span>
        <span className="tabular-nums">V1.0 · BETA · CAMPUS</span>
      </div>
    </footer>
  );
}