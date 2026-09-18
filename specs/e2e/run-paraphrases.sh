#!/bin/bash
# Paraphrase robustness scorer for e02s02. Key-gated: needs LLM keys.
# Scores each pack note solo against expected semantics (type/hours/values).
set -euo pipefail
PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

if [ -z "${OPENROUTER_KEY:-}" ] && [ -z "${GEMINI_KEY:-}" ]; then
  echo "paraphrase pack: SKIPPED (no LLM keys set)"
  exit 0
fi

bun run build >/tmp/paraphrase-build.log 2>&1 || { tail -n 20 /tmp/paraphrase-build.log; exit 1; }
(bun run start -- --port "$PORT" >/tmp/paraphrase-server.log 2>&1 & echo $! > /tmp/paraphrase-server.pid)
trap 'kill "$(cat /tmp/paraphrase-server.pid)" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -sf "${BASE}/health" >/dev/null 2>&1 && break
  sleep 1
done

PACK="$(dirname "$0")/paraphrase-pack.json"
python3 - "$BASE" "$PACK" <<'EOF'
import json, sys, urllib.request
base, pack_path = sys.argv[1], sys.argv[2]
pack = json.load(open(pack_path))
hours = [{"hour": h, "demand_kwh": 120, "solar_kwh": 80 if 6 <= h <= 18 else 0,
          "tariff_bdt_per_kwh": 8} for h in range(24)]

def post(note):
    data = json.dumps({"scenario_id": "pack", "operator_notes": [note],
                       "hours": hours, "battery": pack["defaults"]["battery"]}).encode()
    req = urllib.request.Request(base + "/optimize-energy", method="POST",
                                 headers={"Content-Type": "application/json"}, data=data)
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read())

passed, failed = 0, []
for case in pack["cases"]:
    exp = case["expected"]
    try:
        status, body = post(case["note"])
        got = body["directive_interpretation"][0]
        ok = (status == 200 and got["directive_type"] == exp["directive_type"])
        if ok and exp["directive_type"] == "no_op":
            ok = got["applies"] is False and got["structured_adjustment"] is None
        if ok and exp["directive_type"] != "no_op":
            adj = got["structured_adjustment"] or {}
            ok = (got["applies"] is True and adj.get("hours") == exp["hours"])
            for key in ("factor", "minimum_energy_kwh", "max_grid_kwh"):
                if key in exp:
                    ok = ok and abs(adj.get(key, float("nan")) - exp[key]) <= 0.01
        print(("PASS " if ok else "FAIL ") + case["id"], flush=True)
        passed, failed = (passed + 1, failed) if ok else (passed, failed + [case["id"]])
    except Exception as e:
        print("FAIL " + case["id"] + " error=" + str(e)[:120], flush=True)
        failed.append(case["id"])

total = passed + len(failed)
print(f"paraphrase pack: {passed}/{total} PASS")
if failed:
    print("failed: " + ", ".join(failed))
    sys.exit(1)
EOF

echo "PACK-ALL-GREEN"
