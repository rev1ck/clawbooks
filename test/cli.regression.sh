#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d)"
LEDGER="$ROOT/ledger.jsonl"
POLICY="$ROOT/policy.md"
EVENTS="$ROOT/events.jsonl"
PACK_DIR="$ROOT/pack"

cleanup() {
  rm -rf "$ROOT"
}
trap cleanup EXIT

cat > "$POLICY" <<'EOF'
# Test policy
EOF

cat > "$EVENTS" <<'EOF'
{"source":"manual","type":"opening_balance","ts":"2026-01-01T00:00:00.000Z","data":{"amount":1000,"currency":"USD","account":"checking","category":"cash"}}
{"source":"bank","type":"income","ts":"2026-02-20T00:00:00.000Z","data":{"amount":500,"currency":"USD","category":"service_revenue","description":"Client payment","confidence":"clear"}}
{"source":"bank","type":"expense","ts":"2026-02-18T00:00:00.000Z","data":{"amount":120,"currency":"USD","category":"software","description":"Subscription","confidence":"clear"}}
{"source":"bank","type":"expense","ts":"2026-02-16T00:00:00.000Z","data":{"amount":300,"currency":"USD","category":"hardware","description":"Laptop","confidence":"clear","capitalize":true,"useful_life_months":36}}
{"source":"bank","type":"transfer_in","ts":"2026-02-15T00:00:00.000Z","data":{"amount":250,"currency":"USD","category":"internal_transfer","description":"Move from reserve","confidence":"clear"}}
{"source":"bank","type":"owner_draw","ts":"2026-02-14T00:00:00.000Z","data":{"amount":50,"currency":"USD","category":"owner_draw","description":"Distribution","confidence":"clear"}}
EOF

CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js batch < "$EVENTS" >/dev/null

SUMMARY_SHORTCUT="$ROOT/summary-shortcut.json"
SUMMARY_EXPLICIT="$ROOT/summary-explicit.json"
VERIFY_JSON="$ROOT/verify.json"
STATS_JSON="$ROOT/stats.json"
SNAPSHOT_JSON="$ROOT/snapshot.json"
CONTEXT_COMPACT="$ROOT/context-compact.txt"
CONTEXT_VERBOSE="$ROOT/context-verbose.txt"
CONTEXT_WITH_POLICY="$ROOT/context-with-policy.txt"
POLICY_PATH_OUT="$ROOT/policy-path.txt"

CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js summary 2026-02 > "$SUMMARY_SHORTCUT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js summary --after 2026-02-01 --before 2026-02-28 > "$SUMMARY_EXPLICIT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js verify 2026-02 --balance 1280 --opening-balance 1000 --currency USD > "$VERIFY_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js stats > "$STATS_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js snapshot 2026-02 > "$SNAPSHOT_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js context 2026-02 > "$CONTEXT_COMPACT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js context 2026-02 --verbose > "$CONTEXT_VERBOSE"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js context 2026-02 --include-policy > "$CONTEXT_WITH_POLICY"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js policy --path > "$POLICY_PATH_OUT"
mkdir -p "$PACK_DIR"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js pack 2026-02 --out "$PACK_DIR" >/dev/null

node - <<'EOF' "$SUMMARY_SHORTCUT" "$SUMMARY_EXPLICIT" "$VERIFY_JSON" "$STATS_JSON" "$SNAPSHOT_JSON" "$PACK_DIR/summary.json" "$CONTEXT_COMPACT" "$CONTEXT_VERBOSE" "$CONTEXT_WITH_POLICY" "$POLICY_PATH_OUT" "$POLICY"
const fs = require("fs");
const [summaryShortcutPath, summaryExplicitPath, verifyPath, statsPath, snapshotPath, packedSummaryPath, contextCompactPath, contextVerbosePath, contextWithPolicyPath, policyPathOutPath, expectedPolicyPath] = process.argv.slice(2);
const summaryShortcut = JSON.parse(fs.readFileSync(summaryShortcutPath, "utf8"));
const summaryExplicit = JSON.parse(fs.readFileSync(summaryExplicitPath, "utf8"));
const verify = JSON.parse(fs.readFileSync(verifyPath, "utf8"));
const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const packedSummary = JSON.parse(fs.readFileSync(packedSummaryPath, "utf8"));
const contextCompact = fs.readFileSync(contextCompactPath, "utf8");
const contextVerbose = fs.readFileSync(contextVerbosePath, "utf8");
const contextWithPolicy = fs.readFileSync(contextWithPolicyPath, "utf8");
const policyPathOut = fs.readFileSync(policyPathOutPath, "utf8").trim();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(JSON.stringify(summaryShortcut.movement_summary) === JSON.stringify(summaryExplicit.movement_summary), "month shortcut should match explicit date range");
assert(summaryShortcut.movement_summary.operating_inflows === 500, "operating inflows should be 500");
assert(summaryShortcut.movement_summary.operating_outflows === 120, "capex should be excluded from operating outflows");
assert(summaryShortcut.report_totals.capex === 300, "capex total should be separated");
assert(summaryShortcut.report_totals.internal_transfers_in === 250, "transfer in should be separated");
assert(summaryShortcut.report_totals.owner_distributions === 50, "owner draws should be separated");
assert(verify.balance_check.matches === true, "opening-balance-aware verify should match");
assert(verify.balance_check.net_movement === 280, "net movement should be 280");
assert(verify.balance_check.closing_balance === 1280, "closing balance should be 1280");
assert(stats.first === "2026-01-01T00:00:00.000Z", "stats.first should be chronological");
assert(stats.last === "2026-02-20T00:00:00.000Z", "stats.last should be chronological");
assert(snapshot.movement_summary.operating_inflows === 500, "snapshot should include operating movement summary");
assert(!Object.prototype.hasOwnProperty.call(snapshot, "pnl"), "snapshot should not expose legacy raw pnl");
assert(snapshot.report_totals.capex === 300, "snapshot should include capex totals");
assert(packedSummary.movement_summary.operating_net === 380, "pack summary should include operating movement summary");
assert(contextCompact.includes('verbosity="compact"'), "default context should be compact");
assert(contextVerbose.includes('verbosity="full"'), "verbose context should show full payloads");
assert(!contextCompact.includes("<policy>"), "default context should not inline policy");
assert(contextWithPolicy.includes("<policy>"), "context --include-policy should inline policy");
assert(policyPathOut === expectedPolicyPath, "policy --path should print the configured policy path");
assert(contextCompact.includes('"top_operating_expenses"'), "default context summary should use compact high-signal shape");
assert(contextVerbose.includes('"by_type"'), "verbose context should include the full internal summary");
console.log("cli.regression.sh: ok");
EOF
