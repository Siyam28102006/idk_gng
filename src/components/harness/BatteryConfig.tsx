"use client";

// Battery configuration card — five numeric inputs that drive the
// 24h matrix and the optimizer request body. Inputs are controlled
// so parent owns the live state.

export interface BatteryFields {
  capacity_kwh: number;
  initial_energy_kwh: number;
  minimum_energy_kwh: number;
  max_charge_kwh_per_hour: number;
  max_discharge_kwh_per_hour: number;
}

export interface BatteryConfigProps {
  value: BatteryFields;
  onChange: (next: BatteryFields) => void;
}

const FIELDS: { key: keyof BatteryFields; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "capacity_kwh", label: "Capacity", unit: "kWh", min: 1, max: 1000, step: 1 },
  { key: "initial_energy_kwh", label: "Initial Energy", unit: "kWh", min: 0, max: 1000, step: 1 },
  { key: "minimum_energy_kwh", label: "Min Reserve", unit: "kWh", min: 0, max: 1000, step: 1 },
  { key: "max_charge_kwh_per_hour", label: "Max Charge Rate", unit: "kW", min: 1, max: 1000, step: 1 },
  { key: "max_discharge_kwh_per_hour", label: "Max Discharge Rate", unit: "kW", min: 1, max: 1000, step: 1 },
];

export function BatteryConfig({ value, onChange }: BatteryConfigProps) {
  return (
    <section className="rounded-xl border border-border-soft bg-card p-5">
      <header className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-50">Battery Config</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          BESS-01
        </span>
      </header>

      <div className="mt-4 space-y-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span>{f.label}</span>
              <span className="text-zinc-400 tabular-nums">
                {value[f.key]} {f.unit}
              </span>
            </span>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: Number(e.target.value) })}
              className="mt-1.5 w-full accent-telemetry-grid"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-border-soft bg-raised p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Cycle Headroom
        </h3>
        <p className="mt-1 font-mono text-lg tabular-nums text-zinc-200">
          {Math.max(0, value.capacity_kwh - value.minimum_energy_kwh)}{" "}
          <span className="text-xs text-zinc-500">kWh usable</span>
        </p>
      </div>
    </section>
  );
}