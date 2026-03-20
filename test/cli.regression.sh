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
POLICY_EXAMPLES_JSON="$ROOT/policy-examples.json"
POLICY_SIMPLE_EXAMPLE="$ROOT/policy-simple-example.md"
VERSION_OUT="$ROOT/version.txt"
HELP_OUT="$ROOT/help.txt"

CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js summary 2026-02 > "$SUMMARY_SHORTCUT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js summary --after 2026-02-01 --before 2026-02-28 > "$SUMMARY_EXPLICIT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js verify 2026-02 --balance 1280 --opening-balance 1000 --currency USD > "$VERIFY_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js stats > "$STATS_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js snapshot 2026-02 > "$SNAPSHOT_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js context 2026-02 > "$CONTEXT_COMPACT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js context 2026-02 --verbose > "$CONTEXT_VERBOSE"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js context 2026-02 --include-policy > "$CONTEXT_WITH_POLICY"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js policy --path > "$POLICY_PATH_OUT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js policy --list-examples > "$POLICY_EXAMPLES_JSON"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js policy --example simple > "$POLICY_SIMPLE_EXAMPLE"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js version > "$VERSION_OUT"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js > "$HELP_OUT"
mkdir -p "$PACK_DIR"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js pack 2026-02 --out "$PACK_DIR" >/dev/null

node - <<'EOF' "$SUMMARY_SHORTCUT" "$SUMMARY_EXPLICIT" "$VERIFY_JSON" "$STATS_JSON" "$SNAPSHOT_JSON" "$PACK_DIR/summary.json" "$CONTEXT_COMPACT" "$CONTEXT_VERBOSE" "$CONTEXT_WITH_POLICY" "$POLICY_PATH_OUT" "$POLICY" "$POLICY_EXAMPLES_JSON" "$POLICY_SIMPLE_EXAMPLE" "$VERSION_OUT" "$HELP_OUT"
const fs = require("fs");
const [summaryShortcutPath, summaryExplicitPath, verifyPath, statsPath, snapshotPath, packedSummaryPath, contextCompactPath, contextVerbosePath, contextWithPolicyPath, policyPathOutPath, expectedPolicyPath, policyExamplesPath, policySimpleExamplePath, versionPath, helpPath] = process.argv.slice(2);
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
const versionOut = fs.readFileSync(versionPath, "utf8").trim();
const helpOut = fs.readFileSync(helpPath, "utf8");

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
assert(verify.resolved_scope.event_count === 5, "verify should echo resolved scope event count");
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
assert(fs.readFileSync(policyExamplesPath, "utf8").includes('"name": "simple"'), "policy --list-examples should include simple");
assert(fs.readFileSync(policySimpleExamplePath, "utf8").includes("Example Studio LLC"), "policy --example simple should print the bundled simple policy");
assert(/^\d+\.\d+\.\d+$/.test(versionOut), "version command should print a semver version");
assert(helpOut.includes(`clawbooks v${versionOut}`), "help should include the current version");
assert(contextCompact.includes('"top_operating_expenses"'), "default context summary should use compact high-signal shape");
assert(contextVerbose.includes('"by_type"'), "verbose context should include the full internal summary");
console.log("cli.regression.sh: ok");
EOF

STAGED_NO_IDS="$ROOT/staged-no-ids.jsonl"
cat > "$STAGED_NO_IDS" <<'EOF'
{"ts":"2026-01-02T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-5,"currency":"USD","posting_date":"2026-01-02"}}
{"ts":"2026-01-02T00:00:00.000Z","source":"statement_import","type":"income","data":{"amount":10,"currency":"USD","posting_date":"2026-01-02"}}
EOF
IMPORT_NO_IDS_JSON="$ROOT/import-no-ids.json"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js import check "$STAGED_NO_IDS" > "$IMPORT_NO_IDS_JSON"
node - <<'EOF' "$IMPORT_NO_IDS_JSON"
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (report.command !== "import check") throw new Error("import check should return a report for staged rows without ids");
if (report.actual.count !== 2) throw new Error("import check should process both staged rows without ids");
EOF

VERIFY_YEAR_JSON="$ROOT/verify-year.json"
CLAWBOOKS_LEDGER="$LEDGER" CLAWBOOKS_POLICY="$POLICY" node build/cli.js verify 2026 > "$VERIFY_YEAR_JSON"
node - <<'EOF' "$VERIFY_YEAR_JSON"
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (report.event_count !== 6) throw new Error(`verify 2026 should include the full 2026 slice, got ${report.event_count}`);
EOF

# --- .books/ directory tests ---

BOOKS_ROOT="$(mktemp -d)"
BOOKS_CLEANUP() {
  rm -rf "$BOOKS_ROOT"
}
trap BOOKS_CLEANUP EXIT

CLI="node $(pwd)/build/cli.js"

# Test 1: init creates .books/ with ledger and policy
(cd "$BOOKS_ROOT" && $CLI init 2>&1) > "$BOOKS_ROOT/init-output.txt"
test -d "$BOOKS_ROOT/.books" || { echo "FAIL: init should create .books/"; exit 1; }
test -f "$BOOKS_ROOT/.books/ledger.jsonl" || { echo "FAIL: init should create ledger.jsonl"; exit 1; }
test -f "$BOOKS_ROOT/.books/policy.md" || { echo "FAIL: init should create policy.md"; exit 1; }
test -f "$BOOKS_ROOT/.books/program.md" || { echo "FAIL: init should create program.md"; exit 1; }
grep -q "reporting:" "$BOOKS_ROOT/.books/policy.md" || { echo "FAIL: init policy should contain usable policy content"; exit 1; }
grep -q "Next step: edit policy.md" "$BOOKS_ROOT/init-output.txt" || { echo "FAIL: init output should tell user to edit policy"; exit 1; }
grep -q "Next agent step: run \`clawbooks quickstart\`" "$BOOKS_ROOT/init-output.txt" || { echo "FAIL: init output should point agents to quickstart"; exit 1; }

# Test 2: init is idempotent
(cd "$BOOKS_ROOT" && $CLI init 2>&1) > "$BOOKS_ROOT/init-output2.txt"
grep -q "already exists" "$BOOKS_ROOT/init-output2.txt" || { echo "FAIL: re-init should say already exists"; exit 1; }

# Test 3: init --books creates named directory
(cd "$BOOKS_ROOT" && $CLI init --books .books-personal 2>&1) > /dev/null
test -d "$BOOKS_ROOT/.books-personal" || { echo "FAIL: init --books should create named dir"; exit 1; }
test -f "$BOOKS_ROOT/.books-personal/ledger.jsonl" || { echo "FAIL: init --books should create ledger"; exit 1; }

# Test 3b: init --list-examples shows bundled examples
(cd "$BOOKS_ROOT" && $CLI init --list-examples 2>&1) > "$BOOKS_ROOT/examples.json"
grep -q '"name": "default"' "$BOOKS_ROOT/examples.json" || { echo "FAIL: init --list-examples should include default"; exit 1; }
grep -q '"name": "simple"' "$BOOKS_ROOT/examples.json" || { echo "FAIL: init --list-examples should include simple"; exit 1; }
grep -q '"name": "complex"' "$BOOKS_ROOT/examples.json" || { echo "FAIL: init --list-examples should include complex"; exit 1; }

# Test 4: init --example simple selects the cash-basis example
SIMPLE_DIR="$(mktemp -d)"
(cd "$SIMPLE_DIR" && $CLI init --example simple 2>&1) > "$SIMPLE_DIR/init-simple.txt"
grep -q "Example Studio LLC" "$SIMPLE_DIR/.books/policy.md" || { echo "FAIL: init --example simple should copy simple policy"; exit 1; }
grep -q "Policy seed: simple" "$SIMPLE_DIR/init-simple.txt" || { echo "FAIL: init should confirm selected example"; exit 1; }
rm -rf "$SIMPLE_DIR"

# Test 5: init --example complex selects the accrual/trading example
COMPLEX_DIR="$(mktemp -d)"
(cd "$COMPLEX_DIR" && $CLI init --example complex 2>&1) > "$COMPLEX_DIR/init-complex.txt"
grep -q "Example Trading Operation" "$COMPLEX_DIR/.books/policy.md" || { echo "FAIL: init --example complex should copy complex policy"; exit 1; }
grep -q "Policy seed: complex" "$COMPLEX_DIR/init-complex.txt" || { echo "FAIL: init should confirm selected complex example"; exit 1; }
rm -rf "$COMPLEX_DIR"

# Test 6: invalid example should fail
INVALID_DIR="$(mktemp -d)"
if (cd "$INVALID_DIR" && $CLI init --example nope >/dev/null 2>&1); then
  echo "FAIL: init --example nope should fail"; exit 1
fi
rm -rf "$INVALID_DIR"

# Test 7: record auto-creates .books/ in empty dir
EMPTY_DIR="$(mktemp -d)"
(cd "$EMPTY_DIR" && $CLI record '{"source":"test","type":"income","data":{"amount":100,"currency":"USD"}}' 2>&1) > /dev/null
test -d "$EMPTY_DIR/.books" || { echo "FAIL: record should auto-create .books/"; exit 1; }
test -f "$EMPTY_DIR/.books/ledger.jsonl" || { echo "FAIL: record should create ledger in .books/"; exit 1; }
test -f "$EMPTY_DIR/.books/policy.md" || { echo "FAIL: record should create policy in .books/"; exit 1; }
test -f "$EMPTY_DIR/.books/program.md" || { echo "FAIL: record should create program in .books/"; exit 1; }
grep -q "reporting:" "$EMPTY_DIR/.books/policy.md" || { echo "FAIL: auto-created policy should contain usable policy content"; exit 1; }
rm -rf "$EMPTY_DIR"

# Test 8: read commands error when no books found
EMPTY_DIR2="$(mktemp -d)"
if (cd "$EMPTY_DIR2" && $CLI summary 2026-03 2>/dev/null); then
  echo "FAIL: summary should error when no books found"; exit 1
fi
rm -rf "$EMPTY_DIR2"

# Test 8b: where works before books exist
EMPTY_DIR3="$(mktemp -d)"
WHERE_JSON="$EMPTY_DIR3/where.json"
(cd "$EMPTY_DIR3" && $CLI where 2>&1) > "$WHERE_JSON"
grep -q '"resolution": "default:.books"' "$WHERE_JSON" || { echo "FAIL: where should report default resolution"; exit 1; }
grep -q '"next_command": "clawbooks quickstart"' "$WHERE_JSON" || { echo "FAIL: where should point to quickstart"; exit 1; }

DOCTOR_JSON="$EMPTY_DIR3/doctor.json"
(cd "$EMPTY_DIR3" && $CLI doctor 2>&1) > "$DOCTOR_JSON"
grep -q '"command": "doctor"' "$DOCTOR_JSON" || { echo "FAIL: doctor should identify itself"; exit 1; }
grep -q '"cli_version"' "$DOCTOR_JSON" || { echo "FAIL: doctor should include cli version"; exit 1; }
grep -q '"resolved_books"' "$DOCTOR_JSON" || { echo "FAIL: doctor should report resolved books"; exit 1; }
grep -q '"program_path"' "$DOCTOR_JSON" || { echo "FAIL: doctor should report packaged support paths"; exit 1; }
grep -q '"agent_bootstrap_path"' "$DOCTOR_JSON" || { echo "FAIL: doctor should report agent bootstrap path"; exit 1; }
grep -q '"event_schema_path"' "$DOCTOR_JSON" || { echo "FAIL: doctor should report event schema path"; exit 1; }
grep -q '"suggested_next_command": "clawbooks quickstart"' "$DOCTOR_JSON" || { echo "FAIL: doctor should point users to quickstart"; exit 1; }
grep -q '"readiness": "missing"' "$DOCTOR_JSON" || { echo "FAIL: doctor should report missing policy readiness"; exit 1; }
grep -q '"ledger_health"' "$DOCTOR_JSON" || { echo "FAIL: doctor should include ledger health"; exit 1; }
grep -q '"snapshot_health"' "$DOCTOR_JSON" || { echo "FAIL: doctor should include snapshot health"; exit 1; }
grep -q '"operator_mistakes"' "$DOCTOR_JSON" || { echo "FAIL: doctor should include operator warnings"; exit 1; }
grep -q '"import_workflow"' "$DOCTOR_JSON" || { echo "FAIL: doctor should include import workflow guidance"; exit 1; }
grep -q 'Run `clawbooks init`' "$DOCTOR_JSON" || { echo "FAIL: doctor should recommend init when books are missing"; exit 1; }

QUICKSTART_JSON="$EMPTY_DIR3/quickstart.json"
(cd "$EMPTY_DIR3" && $CLI quickstart 2>&1) > "$QUICKSTART_JSON"
grep -q '"command": "quickstart"' "$QUICKSTART_JSON" || { echo "FAIL: quickstart should identify itself"; exit 1; }
grep -q '"core_files"' "$QUICKSTART_JSON" || { echo "FAIL: quickstart should define core files"; exit 1; }
grep -q '"event_schema"' "$QUICKSTART_JSON" || { echo "FAIL: quickstart should point to the event schema"; exit 1; }
grep -q '"produce_outputs"' "$QUICKSTART_JSON" || { echo "FAIL: quickstart should describe output generation workflow"; exit 1; }
grep -q '"import_support"' "$QUICKSTART_JSON" || { echo "FAIL: quickstart should describe import support surfaces"; exit 1; }

HELP_SUMMARY="$EMPTY_DIR3/help-summary.txt"
(cd "$EMPTY_DIR3" && $CLI summary --help 2>&1) > "$HELP_SUMMARY"
grep -q 'Usage: clawbooks summary' "$HELP_SUMMARY" || { echo "FAIL: summary --help should print command help"; exit 1; }

HELP_IMPORT="$EMPTY_DIR3/help-import.txt"
(cd "$EMPTY_DIR3" && $CLI import check --help 2>&1) > "$HELP_IMPORT"
grep -q 'Usage: clawbooks import check' "$HELP_IMPORT" || { echo "FAIL: import check --help should print command help"; exit 1; }

HELP_IMPORT_MAPPINGS="$EMPTY_DIR3/help-import-mappings.txt"
(cd "$EMPTY_DIR3" && $CLI import mappings --help 2>&1) > "$HELP_IMPORT_MAPPINGS"
grep -q 'Usage: clawbooks import mappings' "$HELP_IMPORT_MAPPINGS" || { echo "FAIL: import mappings --help should print command help"; exit 1; }

HELP_IMPORT_SESSIONS="$EMPTY_DIR3/help-import-sessions.txt"
(cd "$EMPTY_DIR3" && $CLI import sessions --help 2>&1) > "$HELP_IMPORT_SESSIONS"
grep -q 'Usage: clawbooks import sessions' "$HELP_IMPORT_SESSIONS" || { echo "FAIL: import sessions --help should print command help"; exit 1; }

HELP_IMPORT_RECONCILE="$EMPTY_DIR3/help-import-reconcile.txt"
(cd "$EMPTY_DIR3" && $CLI import reconcile --help 2>&1) > "$HELP_IMPORT_RECONCILE"
grep -q 'Usage: clawbooks import reconcile' "$HELP_IMPORT_RECONCILE" || { echo "FAIL: import reconcile --help should print command help"; exit 1; }
if grep -q -- '--recorded-by\|--notes\|--mappings' "$HELP_IMPORT_RECONCILE"; then
  echo "FAIL: import reconcile help should not advertise unsupported flags"
  exit 1
fi

HELP_REVIEW_BATCH="$EMPTY_DIR3/help-review-batch.txt"
(cd "$EMPTY_DIR3" && $CLI review batch --help 2>&1) > "$HELP_REVIEW_BATCH"
grep -q 'Usage: clawbooks review batch' "$HELP_REVIEW_BATCH" || { echo "FAIL: review batch --help should print command help"; exit 1; }
rm -rf "$EMPTY_DIR3"

# Test 8c: import scaffold emits files without institution-specific magic
IMPORT_ROOT="$(mktemp -d)"
IMPORT_JSON="$IMPORT_ROOT/import.json"
(cd "$IMPORT_ROOT" && $CLI import scaffold statement-csv 2>&1) > "$IMPORT_JSON"
grep -q '"kind": "statement-csv"' "$IMPORT_JSON" || { echo "FAIL: import scaffold should report scaffold kind"; exit 1; }
test -f "$IMPORT_ROOT/clawbooks-imports/statement-csv/README.md" || { echo "FAIL: import scaffold should create README"; exit 1; }
test -f "$IMPORT_ROOT/clawbooks-imports/statement-csv/mapper.mjs" || { echo "FAIL: import scaffold should create mapper"; exit 1; }
test -f "$IMPORT_ROOT/clawbooks-imports/statement-csv/mapper.py" || { echo "FAIL: import scaffold should create python mapper"; exit 1; }
test -f "$IMPORT_ROOT/clawbooks-imports/statement-csv/statement-profile.json" || { echo "FAIL: statement scaffold should create statement profile template"; exit 1; }
test -f "$IMPORT_ROOT/clawbooks-imports/statement-csv/vendor-mappings.json" || { echo "FAIL: statement scaffold should create vendor mappings template"; exit 1; }
grep -q 'transaction_date' "$IMPORT_ROOT/clawbooks-imports/statement-csv/mapper.mjs" || { echo "FAIL: statement scaffold should mention transaction_date"; exit 1; }
grep -q 'transaction_date' "$IMPORT_ROOT/clawbooks-imports/statement-csv/mapper.py" || { echo "FAIL: python statement scaffold should mention transaction_date"; exit 1; }
grep -q 'vendor-mappings.json' "$IMPORT_ROOT/clawbooks-imports/statement-csv/README.md" || { echo "FAIL: statement scaffold readme should mention vendor mappings"; exit 1; }
mkdir -p "$IMPORT_ROOT/.books"
cat > "$IMPORT_ROOT/.books/ledger.jsonl" <<'EOF'
{"ts":"2026-02-01T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-10,"currency":"USD","description":"NETFLIX","category":"software","confidence":"inferred"},"id":"hist1","prev":"genesis"}
{"ts":"2026-02-15T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-12,"currency":"USD","description":"NETFLIX","category":"software","confidence":"inferred"},"id":"hist2","prev":"x"}
{"ts":"2026-02-28T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-11,"currency":"USD","description":"NETFLIX","category":"software","confidence":"inferred"},"id":"hist3","prev":"y"}
EOF
cat > "$IMPORT_ROOT/.books/policy.md" <<'EOF'
# test policy
EOF
cat > "$IMPORT_ROOT/.books/vendor-mappings.json" <<'EOF'
{"mappings":[{"match":"PAYROLL","type":"income","category":"service_revenue","confidence":"inferred"}]}
EOF
cat > "$IMPORT_ROOT/staged.jsonl" <<'EOF'
{"ts":"2026-03-05T00:00:00.000Z","source":"statement_import","type":"income","data":{"amount":200,"currency":"USD","description":"PAYROLL","category":"service_revenue","confidence":"inferred","transaction_date":"2026-03-04","posting_date":"2026-03-05"}}
{"ts":"2026-03-18T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-300,"currency":"USD","description":"APPLE.COM/BILL","category":"software_and_digital_services","confidence":"inferred","transaction_date":"2026-03-17","posting_date":"2026-03-18"}}
EOF
cat > "$IMPORT_ROOT/statement-profile.json" <<'EOF'
{"statement_id":"stmt-1","source":"statement_import","currency":"USD","date_basis":"posting","statement_start":"2026-03-01","statement_end":"2026-03-31","opening_balance":1000,"closing_balance":900,"count":2,"debits":-300,"credits":200,"newest_first":false}
EOF
IMPORT_CHECK_JSON="$IMPORT_ROOT/import-check.json"
(cd "$IMPORT_ROOT" && $CLI import check staged.jsonl --statement statement-profile.json --mappings clawbooks-imports/statement-csv/vendor-mappings.json --save-session --session-id test-session 2>&1) > "$IMPORT_CHECK_JSON"
grep -q '"command": "import check"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should identify itself"; exit 1; }
grep -q '"status": "ok"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should reconcile staged file"; exit 1; }
grep -q '"closing_balance": 900' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should compute closing balance"; exit 1; }
grep -q '"statement_profile"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should report loaded statement profile"; exit 1; }
grep -q '"provenance_coverage"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should report provenance coverage"; exit 1; }
grep -q '"filtered_event_count": 2' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should report filtered event count"; exit 1; }
grep -q '"mapping_diagnostics"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should report mapping diagnostics"; exit 1; }
grep -q '"matched_event_count": 2' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should report mapping coverage"; exit 1; }
grep -q '"what_matters"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should include operator-facing summary text"; exit 1; }
grep -q '"source_coverage"' "$IMPORT_CHECK_JSON" || { echo "FAIL: import check should report source coverage"; exit 1; }
test -f "$IMPORT_ROOT/.books/imports/sessions/test-session.json" || { echo "FAIL: import check should save import session sidecar"; exit 1; }

IMPORT_SESSIONS_LIST="$IMPORT_ROOT/import-sessions-list.json"
(cd "$IMPORT_ROOT" && $CLI import sessions list 2>&1) > "$IMPORT_SESSIONS_LIST"
grep -q '"command": "import sessions list"' "$IMPORT_SESSIONS_LIST" || { echo "FAIL: import sessions list should identify itself"; exit 1; }
grep -q '"import_session": "test-session"' "$IMPORT_SESSIONS_LIST" || { echo "FAIL: import sessions list should include saved session"; exit 1; }

IMPORT_SESSIONS_SHOW="$IMPORT_ROOT/import-sessions-show.json"
(cd "$IMPORT_ROOT" && $CLI import sessions show latest 2>&1) > "$IMPORT_SESSIONS_SHOW"
grep -q '"command": "import sessions show"' "$IMPORT_SESSIONS_SHOW" || { echo "FAIL: import sessions show should identify itself"; exit 1; }
grep -q '"session_schema_version": "clawbooks.import-session.v1"' "$IMPORT_SESSIONS_SHOW" || { echo "FAIL: import sessions show should expose session schema version"; exit 1; }

IMPORT_RECONCILE_JSON="$IMPORT_ROOT/import-reconcile.json"
(cd "$IMPORT_ROOT" && $CLI import reconcile staged.jsonl --statement statement-profile.json 2>&1) > "$IMPORT_RECONCILE_JSON"
grep -q '"command": "import reconcile"' "$IMPORT_RECONCILE_JSON" || { echo "FAIL: import reconcile should identify itself"; exit 1; }
grep -q '"statement"' "$IMPORT_RECONCILE_JSON" || { echo "FAIL: import reconcile should include statement metadata"; exit 1; }
grep -q '"unexplained_deltas"' "$IMPORT_RECONCILE_JSON" || { echo "FAIL: import reconcile should include unexplained deltas"; exit 1; }

cat > "$IMPORT_ROOT/statement-profile-bad-close.json" <<'EOF'
{"statement_id":"stmt-bad-close","source":"statement_import","currency":"USD","date_basis":"posting","statement_start":"2026-03-01","statement_end":"2026-03-31","opening_balance":1000,"closing_balance":1200,"count":2,"debits":-300,"credits":200,"newest_first":false}
EOF
IMPORT_RECONCILE_BAD_CLOSE="$IMPORT_ROOT/import-reconcile-bad-close.json"
(cd "$IMPORT_ROOT" && $CLI import reconcile staged.jsonl --statement statement-profile-bad-close.json 2>&1) > "$IMPORT_RECONCILE_BAD_CLOSE"
grep -q '"workflow_state": "needs_reconciliation"' "$IMPORT_RECONCILE_BAD_CLOSE" || { echo "FAIL: import reconcile should fail when closing balance disagrees"; exit 1; }

IMPORT_CHECK_DISCOVERY="$IMPORT_ROOT/import-check-discovery.json"
(cd "$IMPORT_ROOT" && $CLI import check staged.jsonl --statement statement-profile.json 2>&1) > "$IMPORT_CHECK_DISCOVERY"
grep -q '"available": true' "$IMPORT_CHECK_DISCOVERY" || { echo "FAIL: import check should discover .books/vendor-mappings.json"; exit 1; }
grep -q '"checked_paths"' "$IMPORT_CHECK_DISCOVERY" || { echo "FAIL: import check should report mappings discovery paths"; exit 1; }
grep -q '".*/.books/vendor-mappings.json"' "$IMPORT_CHECK_DISCOVERY" || { echo "FAIL: import check should include .books/vendor-mappings.json in discovery"; exit 1; }

IMPORT_MAPPINGS_SUGGEST="$IMPORT_ROOT/import-mappings-suggest.json"
(cd "$IMPORT_ROOT" && $CLI import mappings suggest --source statement_import 2>&1) > "$IMPORT_MAPPINGS_SUGGEST"
grep -q '"command": "import mappings suggest"' "$IMPORT_MAPPINGS_SUGGEST" || { echo "FAIL: import mappings suggest should identify itself"; exit 1; }
grep -q '"NETFLIX"' "$IMPORT_MAPPINGS_SUGGEST" || { echo "FAIL: import mappings suggest should surface stable recurring descriptions"; exit 1; }

IMPORT_MAPPINGS_CHECK="$IMPORT_ROOT/import-mappings-check.json"
(cd "$IMPORT_ROOT" && $CLI import mappings check staged.jsonl --mappings clawbooks-imports/statement-csv/vendor-mappings.json 2>&1) > "$IMPORT_MAPPINGS_CHECK"
grep -q '"command": "import mappings check"' "$IMPORT_MAPPINGS_CHECK" || { echo "FAIL: import mappings check should identify itself"; exit 1; }
grep -q '"file_checks"' "$IMPORT_MAPPINGS_CHECK" || { echo "FAIL: import mappings check should report file checks"; exit 1; }
grep -q '"event_diagnostics"' "$IMPORT_MAPPINGS_CHECK" || { echo "FAIL: import mappings check should report event diagnostics"; exit 1; }

cat > "$IMPORT_ROOT/staged-newest-first.jsonl" <<'EOF'
{"ts":"2026-03-18T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-300,"currency":"USD","transaction_date":"2026-03-17","posting_date":"2026-03-18"}}
{"ts":"2026-03-05T00:00:00.000Z","source":"statement_import","type":"income","data":{"amount":200,"currency":"USD","transaction_date":"2026-03-04","posting_date":"2026-03-05"}}
EOF
cat > "$IMPORT_ROOT/statement-profile-newest.json" <<'EOF'
{"statement_id":"stmt-2","source":"statement_import","currency":"USD","date_basis":"posting","statement_start":"2026-03-01","statement_end":"2026-03-31","opening_balance":1000,"closing_balance":900,"count":2,"debits":-300,"credits":200,"newest_first":true}
EOF
IMPORT_CHECK_NEWEST="$IMPORT_ROOT/import-check-newest.json"
(cd "$IMPORT_ROOT" && $CLI import check staged-newest-first.jsonl --statement statement-profile-newest.json 2>&1) > "$IMPORT_CHECK_NEWEST"
grep -q '"status": "ok"' "$IMPORT_CHECK_NEWEST" || { echo "FAIL: import check should accept correctly newest-first staged files"; exit 1; }
grep -q '"filtered"' "$IMPORT_CHECK_NEWEST" || { echo "FAIL: import check should report filtered ordering separately"; exit 1; }
grep -q '"scoped"' "$IMPORT_CHECK_NEWEST" || { echo "FAIL: import check should report scoped ordering separately"; exit 1; }

cat > "$IMPORT_ROOT/staged-out-of-period.jsonl" <<'EOF'
{"ts":"2026-02-27T00:00:00.000Z","source":"statement_import","type":"income","data":{"amount":50,"currency":"USD","posting_date":"2026-02-27"}}
{"ts":"2026-03-05T00:00:00.000Z","source":"statement_import","type":"income","data":{"amount":200,"currency":"USD","posting_date":"2026-03-05"}}
EOF
IMPORT_CHECK_OOP="$IMPORT_ROOT/import-check-oop.json"
(cd "$IMPORT_ROOT" && $CLI import check staged-out-of-period.jsonl --statement statement-profile-newest.json 2>&1) > "$IMPORT_CHECK_OOP"
grep -q '"status": "mismatch"' "$IMPORT_CHECK_OOP" || { echo "FAIL: import check should flag out-of-period staged rows"; exit 1; }
grep -q 'out-of-period' "$IMPORT_CHECK_OOP" || { echo "FAIL: import check should explain out-of-period rows"; exit 1; }
rm -rf "$IMPORT_ROOT"

# Test 9: --books flag works for commands
(cd "$BOOKS_ROOT" && $CLI --books .books record '{"source":"test","type":"income","data":{"amount":200,"currency":"USD"}}' 2>&1) > /dev/null
BOOKS_STATS="$BOOKS_ROOT/books-stats.json"
(cd "$BOOKS_ROOT" && $CLI --books .books stats 2>&1) > "$BOOKS_STATS"
node -e "const s = JSON.parse(require('fs').readFileSync('$BOOKS_STATS','utf8')); if (s.events !== 1) throw new Error('expected 1 event via --books, got ' + s.events)"

# Test 10: CLAWBOOKS_BOOKS env var works
BOOKS_STATS2="$BOOKS_ROOT/books-stats2.json"
(cd "$BOOKS_ROOT" && CLAWBOOKS_BOOKS=.books-personal $CLI record '{"source":"test","type":"expense","data":{"amount":50,"currency":"USD"}}' 2>&1) > /dev/null
(cd "$BOOKS_ROOT" && CLAWBOOKS_BOOKS=.books-personal $CLI stats 2>&1) > "$BOOKS_STATS2"
node -e "const s = JSON.parse(require('fs').readFileSync('$BOOKS_STATS2','utf8')); if (s.events !== 1) throw new Error('expected 1 event in personal books, got ' + s.events)"

# Test 11: walk-up resolution from subdirectory
mkdir -p "$BOOKS_ROOT/subdir/nested"
WALKUP_STATS="$BOOKS_ROOT/walkup-stats.json"
(cd "$BOOKS_ROOT/subdir/nested" && $CLI stats 2>&1) > "$WALKUP_STATS"
node -e "const s = JSON.parse(require('fs').readFileSync('$WALKUP_STATS','utf8')); if (s.events !== 1) throw new Error('walk-up should find .books/')"

# Test 12: backward compat — bare ledger.jsonl still works
BARE_DIR="$(mktemp -d)"
echo '' > "$BARE_DIR/ledger.jsonl"
echo '# test' > "$BARE_DIR/policy.md"
(cd "$BARE_DIR" && $CLI record '{"source":"test","type":"income","data":{"amount":99,"currency":"USD"}}' 2>&1) > /dev/null
test ! -d "$BARE_DIR/.books" || { echo "FAIL: bare file mode should not create .books/"; exit 1; }
BARE_STATS="$BARE_DIR/bare-stats.json"
(cd "$BARE_DIR" && $CLI stats 2>&1) > "$BARE_STATS"
node -e "const s = JSON.parse(require('fs').readFileSync('$BARE_STATS','utf8')); if (s.events !== 1) throw new Error('bare mode should work')"
rm -rf "$BARE_DIR"

# Test 13: pack default output goes to books dir
(cd "$BOOKS_ROOT" && $CLI --books .books pack 2>&1) > /dev/null
PACK_DIRS=$(ls -d "$BOOKS_ROOT/.books/audit-pack-"* 2>/dev/null | wc -l)
test "$PACK_DIRS" -ge 1 || { echo "FAIL: pack should output to books dir by default"; exit 1; }

# Test 14: policy lint + documents + neutral summary/context fields
DOCS_ROOT="$(mktemp -d)"
mkdir -p "$DOCS_ROOT/.books"
cat > "$DOCS_ROOT/.books/policy.md" <<'EOF'
# Accounting policy

## Structured policy hints

```yaml
entity:
  legal_name: Doc Test LLC
reporting:
  basis: accrual
  base_currency: USD
```

## Entity

Test entity.
EOF

cat > "$DOCS_ROOT/.books/ledger.jsonl" <<'EOF'
{"ts":"2026-03-01T00:00:00.000Z","source":"manual","type":"invoice","data":{"amount":500,"currency":"USD","direction":"issued","invoice_id":"INV-001","counterparty":"acme","due_date":"2026-03-15","confidence":"clear"},"id":"doc1","prev":"genesis"}
{"ts":"2026-03-05T00:00:00.000Z","source":"bank","type":"income","data":{"amount":200,"currency":"USD","invoice_id":"INV-001","description":"Partial payment","confidence":"clear","transaction_date":"2026-03-04","posting_date":"2026-03-05"},"id":"pay1","prev":"x"}
{"ts":"2026-03-02T00:00:00.000Z","source":"manual","type":"bill","data":{"amount":300,"currency":"USD","direction":"received","invoice_id":"BILL-001","counterparty":"aws","due_date":"2026-03-20","confidence":"clear"},"id":"doc2","prev":"y"}
{"ts":"2026-03-18T00:00:00.000Z","source":"bank","type":"expense","data":{"amount":-300,"currency":"USD","invoice_id":"BILL-001","description":"Bill payment","confidence":"clear","transaction_date":"2026-03-17","posting_date":"2026-03-18"},"id":"pay2","prev":"z"}
{"ts":"2026-03-10T00:00:00.000Z","source":"manual","type":"invoice","data":{"amount":120,"currency":"USD","direction":"issued","counterparty":"beta","confidence":"clear"},"id":"doc3","prev":"q"}
{"ts":"2026-03-12T00:00:00.000Z","source":"bank","type":"expense","data":{"amount":75,"currency":"USD","category":"software","confidence":"unclear","transaction_date":"2026-03-11","posting_date":"2026-03-12"},"id":"rev1","prev":"w"}
{"ts":"2026-03-13T00:00:00.000Z","source":"bank","type":"expense","data":{"amount":40,"currency":"USD","category":"meals","confidence":"inferred","recorded_by":"agent-1","transaction_date":"2026-03-13","posting_date":"2026-03-13"},"id":"rev2","prev":"r"}
{"ts":"2026-03-14T00:00:00.000Z","source":"manual","type":"confirm","data":{"original_id":"rev1","confidence":"clear","confirmed_by":"reviewer-1","notes":"matched to receipt"},"id":"conf1","prev":"s"}
{"ts":"2026-03-15T00:00:00.000Z","source":"manual","type":"correction","data":{"original_id":"pay1","reason":"bank memo typo","corrected_fields":{"description":"Partial payment corrected"}},"id":"corr1","prev":"t"}
EOF

POLICY_LINT="$DOCS_ROOT/policy-lint.json"
(cd "$DOCS_ROOT" && $CLI policy lint 2>&1) > "$POLICY_LINT"
grep -q '"status": "warn"' "$POLICY_LINT" || { echo "FAIL: policy lint should warn on incomplete policy"; exit 1; }
grep -q 'Revenue recognition' "$POLICY_LINT" || { echo "FAIL: policy lint should suggest missing sections"; exit 1; }

POLICY_OK_ROOT="$(mktemp -d)"
mkdir -p "$POLICY_OK_ROOT/.books"
touch "$POLICY_OK_ROOT/.books/ledger.jsonl"
cat > "$POLICY_OK_ROOT/.books/policy.md" <<'EOF'
# Accounting policy

## Structured policy hints

```yaml
entity:
  legal_name: Ready Policy LLC
reporting:
  basis: cash
  base_currency: USD
```

## Entity

Ready Policy LLC is a consulting business.

## Revenue recognition

Recognize revenue on cash receipt.

## Expense recognition

Recognize expenses on payment.

## Reconciliation

Use statement totals and balance checks on import.

## Data conventions

Preserve data.source_doc, data.source_row, and data.recorded_by where available.
EOF
POLICY_OK_JSON="$POLICY_OK_ROOT/policy-ok.json"
(cd "$POLICY_OK_ROOT" && $CLI policy lint 2>&1) > "$POLICY_OK_JSON"
grep -q '"status": "ok"' "$POLICY_OK_JSON" || { echo "FAIL: policy lint should allow info-only guidance without downgrading status"; exit 1; }
rm -rf "$POLICY_OK_ROOT"

DOCTOR_DOCS="$DOCS_ROOT/doctor.json"
(cd "$DOCS_ROOT" && $CLI doctor 2>&1) > "$DOCTOR_DOCS"
grep -q '"readiness": "starter"' "$DOCTOR_DOCS" || { echo "FAIL: doctor should report starter policy readiness"; exit 1; }
grep -q '"provisional_outputs": true' "$DOCTOR_DOCS" || { echo "FAIL: doctor should mark starter policy outputs as provisional"; exit 1; }
grep -q '"policy_path": ".*/.books/policy.md"' "$DOCTOR_DOCS" || { echo "FAIL: doctor should include resolved policy path"; exit 1; }
grep -q '"suggested_next_command": "clawbooks quickstart"' "$DOCTOR_DOCS" || { echo "FAIL: doctor should direct agents to quickstart"; exit 1; }
grep -q '"chain_valid": false' "$DOCTOR_DOCS" || { echo "FAIL: doctor should report broken ledger chains"; exit 1; }
grep -q '"status": "none"' "$DOCTOR_DOCS" || { echo "FAIL: doctor should report missing snapshots"; exit 1; }
grep -q 'No opening_balance or snapshot events found' "$DOCTOR_DOCS" || { echo "FAIL: doctor should warn when opening balances and snapshots are missing"; exit 1; }
grep -q 'no provenance fields' "$DOCTOR_DOCS" || { echo "FAIL: doctor should warn about missing provenance"; exit 1; }

QUICKSTART_DOCS="$DOCS_ROOT/quickstart.json"
(cd "$DOCS_ROOT" && $CLI quickstart 2>&1) > "$QUICKSTART_DOCS"
grep -q '"readiness": "starter"' "$QUICKSTART_DOCS" || { echo "FAIL: quickstart should surface policy readiness"; exit 1; }
grep -q '"provisional_outputs": true' "$QUICKSTART_DOCS" || { echo "FAIL: quickstart should mark starter outputs as provisional"; exit 1; }
grep -q '"path": ".*/docs/event-schema.md"' "$QUICKSTART_DOCS" || { echo "FAIL: quickstart should include event schema path"; exit 1; }
grep -q 'balance sheet' "$QUICKSTART_DOCS" || { echo "FAIL: quickstart should describe broader reporting outcomes"; exit 1; }

DOCUMENTS_JSON="$DOCS_ROOT/documents.json"
(cd "$DOCS_ROOT" && $CLI documents 2026-03 --as-of 2026-03-31T00:00:00.000Z 2>&1) > "$DOCUMENTS_JSON"
grep -q '"partial": 1' "$DOCUMENTS_JSON" || { echo "FAIL: documents should show one partial settlement"; exit 1; }
grep -q '"settled": 1' "$DOCUMENTS_JSON" || { echo "FAIL: documents should show one settled document"; exit 1; }
grep -q '"missing_invoice_id_documents": 1' "$DOCUMENTS_JSON" || { echo "FAIL: documents should show one missing invoice_id"; exit 1; }
grep -q '"invoice_id": "INV-001"' "$DOCUMENTS_JSON" || { echo "FAIL: documents should include INV-001"; exit 1; }
grep -q '"open_balance": 300' "$DOCUMENTS_JSON" || { echo "FAIL: documents should show open balance for partial invoice"; exit 1; }

SUMMARY_DOCS="$DOCS_ROOT/summary-docs.json"
(cd "$DOCS_ROOT" && $CLI summary 2026-03 2>&1) > "$SUMMARY_DOCS"
grep -q '"settlement_summary"' "$SUMMARY_DOCS" || { echo "FAIL: summary should include settlement_summary"; exit 1; }
grep -q '"receivable_candidates"' "$SUMMARY_DOCS" || { echo "FAIL: summary should include receivable_candidates"; exit 1; }
grep -q '"review_materiality"' "$SUMMARY_DOCS" || { echo "FAIL: summary should include review_materiality"; exit 1; }
grep -q '"correction_summary"' "$SUMMARY_DOCS" || { echo "FAIL: summary should include correction_summary"; exit 1; }
grep -q '"confirm_events": 1' "$SUMMARY_DOCS" || { echo "FAIL: summary should include confirm count"; exit 1; }
grep -q '"correction_events": 1' "$SUMMARY_DOCS" || { echo "FAIL: summary should include correction count"; exit 1; }
grep -q '"resolved_scope"' "$SUMMARY_DOCS" || { echo "FAIL: summary should echo resolved scope"; exit 1; }
grep -q '"coverage"' "$SUMMARY_DOCS" || { echo "FAIL: summary should include coverage metadata"; exit 1; }

CONTEXT_DOCS="$DOCS_ROOT/context-docs.txt"
(cd "$DOCS_ROOT" && $CLI context 2026-03 2>&1) > "$CONTEXT_DOCS"
grep -q '"settlement_summary"' "$CONTEXT_DOCS" || { echo "FAIL: context should include settlement_summary"; exit 1; }
grep -q '"top_open_documents"' "$CONTEXT_DOCS" || { echo "FAIL: context should include top_open_documents"; exit 1; }
grep -q '"review_materiality"' "$CONTEXT_DOCS" || { echo "FAIL: context should include review_materiality"; exit 1; }
grep -q '"correction_summary"' "$CONTEXT_DOCS" || { echo "FAIL: context should include correction_summary"; exit 1; }

REVIEW_DOCS="$DOCS_ROOT/review-docs.json"
(cd "$DOCS_ROOT" && $CLI review 2026-03 2>&1) > "$REVIEW_DOCS"
grep -q '"needs_review": 1' "$REVIEW_DOCS" || { echo "FAIL: confirmed items should be excluded from review"; exit 1; }
grep -q '"id": "rev2"' "$REVIEW_DOCS" || { echo "FAIL: remaining inferred item should stay in review"; exit 1; }
grep -q '"reason_in_queue"' "$REVIEW_DOCS" || { echo "FAIL: review should explain why items are in queue"; exit 1; }
grep -q '"resolved_scope"' "$REVIEW_DOCS" || { echo "FAIL: review should echo resolved scope"; exit 1; }
grep -q '"next_best_command"' "$REVIEW_DOCS" || { echo "FAIL: review should suggest a next best command"; exit 1; }

REVIEW_FILTERED="$DOCS_ROOT/review-filtered.json"
(cd "$DOCS_ROOT" && $CLI review 2026-03 --confidence inferred --min-magnitude 100 --group-by category 2>&1) > "$REVIEW_FILTERED"
grep -q '"confidence": \[' "$REVIEW_FILTERED" || { echo "FAIL: review should report applied confidence filter"; exit 1; }
grep -q '"min_magnitude": 100' "$REVIEW_FILTERED" || { echo "FAIL: review should report applied materiality filter"; exit 1; }
grep -q '"group_by": "category"' "$REVIEW_FILTERED" || { echo "FAIL: review should report grouping choice"; exit 1; }
grep -q '"next_actions"' "$REVIEW_FILTERED" || { echo "FAIL: review should emit next action templates"; exit 1; }

REVIEW_LIMITED="$DOCS_ROOT/review-limited.json"
(cd "$DOCS_ROOT" && $CLI review 2026-03 --limit 1 2>&1) > "$REVIEW_LIMITED"
grep -q '"needs_review": 1' "$REVIEW_LIMITED" || { echo "FAIL: review limit should cap visible items"; exit 1; }
grep -q '"inferred": 1' "$REVIEW_LIMITED" || { echo "FAIL: review counts should reflect limited visible queue"; exit 1; }
grep -q '"total_by_confidence"' "$REVIEW_LIMITED" || { echo "FAIL: review should expose total queue counts separately"; exit 1; }

REVIEW_BATCH="$DOCS_ROOT/review-actions.jsonl"
REVIEW_BATCH_JSON="$DOCS_ROOT/review-batch.json"
(cd "$DOCS_ROOT" && $CLI review batch 2026-03 --out "$REVIEW_BATCH" --action confirm --confidence inferred 2>&1) > "$REVIEW_BATCH_JSON"
test -f "$REVIEW_BATCH" || { echo "FAIL: review batch should write action file"; exit 1; }
grep -q '"command": "review batch"' "$REVIEW_BATCH_JSON" || { echo "FAIL: review batch should identify itself"; exit 1; }
grep -q '"status": "ok"' "$REVIEW_BATCH_JSON" || { echo "FAIL: review batch should report success status"; exit 1; }
grep -q '"item_count": 1' "$REVIEW_BATCH_JSON" || { echo "FAIL: review batch should report generated item count"; exit 1; }
grep -q '"type":"confirm"' "$REVIEW_BATCH" || { echo "FAIL: review batch should emit confirm events"; exit 1; }

REVIEW_BATCH_EMPTY_JSON="$DOCS_ROOT/review-batch-empty.json"
(cd "$DOCS_ROOT" && $CLI review batch 2026-03 --out "$DOCS_ROOT/unused.jsonl" --action confirm --confidence unclear --min-magnitude 1000 2>&1) > "$REVIEW_BATCH_EMPTY_JSON"
grep -q '"status": "empty"' "$REVIEW_BATCH_EMPTY_JSON" || { echo "FAIL: review batch should report empty queues cleanly"; exit 1; }

RECONCILE_DATE_BASIS="$DOCS_ROOT/reconcile-date-basis.json"
(cd "$DOCS_ROOT" && $CLI reconcile 2026-03 --source bank --date-basis posting --count 4 --opening-balance 100 --closing-balance 115 2>&1) > "$RECONCILE_DATE_BASIS"
grep -q '"date_basis": "posting"' "$RECONCILE_DATE_BASIS" || { echo "FAIL: reconcile should report date basis"; exit 1; }
grep -q '"closing_balance"' "$RECONCILE_DATE_BASIS" || { echo "FAIL: reconcile should include closing balance checks"; exit 1; }
grep -q '"resolved_scope"' "$RECONCILE_DATE_BASIS" || { echo "FAIL: reconcile should echo resolved scope"; exit 1; }

PACK_OUT="$DOCS_ROOT/pack"
mkdir -p "$PACK_OUT"
(cd "$DOCS_ROOT" && $CLI pack 2026-03 --out "$PACK_OUT" >/dev/null 2>&1)
test -f "$PACK_OUT/corrections.csv" || { echo "FAIL: pack should include corrections.csv"; exit 1; }
test -f "$PACK_OUT/confirmations.csv" || { echo "FAIL: pack should include confirmations.csv"; exit 1; }
rm -rf "$DOCS_ROOT"

echo "books-resolution tests: ok"
