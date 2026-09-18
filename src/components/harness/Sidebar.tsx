"use client";

// Left-hand "Grid Topologies" sidebar in the stitch design. For the
// harness we keep one active topology (Campus) and expose the others
// as informational chips so reviewers can see the system supports
// microgrid/neighborhood/prosumer flavors without breaking flow.

const TOPOLOGIES = [
  { id: "campus", label: "Campus · Active", active: true },
  { id: "microgrid", label: "Microgrid", active: false },
  { id: "neighborhood", label: "Neighborhood", active: false },
  { id: "prosumer", label: "Prosumer Cluster", active: false },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border-soft bg-card px-4 py-6 lg:block">
      <h2 className="px-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        Grid Topologies
      </h2>
      <ul className="mt-3 space-y-1">
        {TOPOLOGIES.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={!t.active}
              className={
                "w-full rounded-md px-3 py-2 text-left text-xs transition-colors " +
                (t.active
                  ? "border border-telemetry-grid/40 bg-telemetry-grid/10 text-telemetry-grid"
                  : "border border-transparent text-zinc-500 hover:border-border-soft hover:bg-raised hover:text-zinc-300")
              }
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-8 px-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Solver
        </h3>
        <p className="mt-2 text-xs text-zinc-400">HiGHS LP · WebAssembly</p>
        <p className="mt-1 font-mono text-[10px] text-zinc-500 tabular-nums">
          24h × 5 vars/hour · cold-init &lt; 1.5s
        </p>
      </div>
    </aside>
  );
}