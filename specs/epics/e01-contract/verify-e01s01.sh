#!/bin/bash
# E2E verify for e01s01: health + optimize tracer over a production server.
set -euo pipefail
PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

bun run build >/dev/null 2>&1
(bun run start -- --port "$PORT" >/tmp/e01s01-server.log 2>&1 & echo $! > /tmp/e01s01-server.pid)
trap 'kill "$(cat /tmp/e01s01-server.pid)" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -sf "${BASE}/health" >/dev/null 2>&1 && break
  sleep 1
done

HEALTH="$(curl -s -w '\n%{http_code}' "${BASE}/health")"
echo "$HEALTH" | grep -q '^{"status":"ok"}$' && echo "$HEALTH" | grep -q '200$' \
  && echo "health: OK"

python3 - "$BASE" <<'EOF'
import json, sys, urllib.request
base = sys.argv[1]
hours = [{"hour": h, "demand_kwh": 100 + h,
          "solar_kwh": 60 if 6 <= h <= 18 else 0,
          "tariff_bdt_per_kwh": 12 if 17 <= h <= 21 else 7} for h in range(24)]
payload = {"scenario_id": "tracer-01",
           "operator_notes": ["Panel washing from one until three in the afternoon.",
                              "The cafeteria menu changes tomorrow."],
           "hours": hours,
           "battery": {"capacity_kwh": 200, "initial_energy_kwh": 100,
                       "minimum_energy_kwh": 20, "max_charge_kwh_per_hour": 50,
                       "max_discharge_kwh_per_hour": 50}}

def post(data, raw=False):
    req = urllib.request.Request(base + "/optimize-energy", method="POST",
                                 headers={"Content-Type": "application/json"},
                                 data=data if isinstance(data, bytes) else json.dumps(data).encode())
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

status, body = post(payload)
assert status == 200, status
assert body["scenario_id"] == "tracer-01"
assert [d["note_index"] for d in body["directive_interpretation"]] == [0, 1]
assert [h["hour"] for h in body["hourly_plan"]] == list(range(24))
for h in body["hourly_plan"]:
    if h["battery_action"] == "idle":
        assert h["battery_kwh"] == 0, h
    assert h["grid_kwh"] >= 0, h
grids = [h["grid_kwh"] for h in body["hourly_plan"]]
assert abs(body["total_grid_kwh"] - sum(grids)) <= 0.01
cost = sum(h["grid_kwh"] * hours[i]["tariff_bdt_per_kwh"] for i, h in enumerate(body["hourly_plan"]))
assert abs(body["total_cost_bdt"] - cost) <= 0.01
assert abs(body["peak_grid_kwh"] - max(grids)) <= 0.01
assert abs(body["hourly_plan"][23]["battery_energy_after_kwh"] - 100) <= 0.01
print("optimize happy path: OK")

status, body = post("{not json", raw=True)
assert status == 400 and "error" in body, (status, body)
bad = dict(payload); bad["hours"] = bad["hours"][:23]
status, _ = post(bad)
assert status == 400, status
bad = dict(payload); bad["battery"] = dict(payload["battery"], minimum_energy_kwh=250)
status, body = post(bad)
assert status == 422 and "error" in body, (status, body)
assert "stack" not in json.dumps(body)
print("controlled errors: OK")
EOF

echo "ALL-CHECKS-PASS"
