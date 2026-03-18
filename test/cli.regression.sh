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
grep -q "reporting:" "$BOOKS_ROOT/.books/policy.md" || { echo "FAIL: init policy should contain usable policy content"; exit 1; }
grep -q "Next step: edit policy.md" "$BOOKS_ROOT/init-output.txt" || { echo "FAIL: init output should tell user to edit policy"; exit 1; }

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
rm -rf "$EMPTY_DIR3"

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
{"ts":"2026-03-05T00:00:00.000Z","source":"bank","type":"income","data":{"amount":200,"currency":"USD","invoice_id":"INV-001","description":"Partial payment","confidence":"clear"},"id":"pay1","prev":"x"}
{"ts":"2026-03-02T00:00:00.000Z","source":"manual","type":"bill","data":{"amount":300,"currency":"USD","direction":"received","invoice_id":"BILL-001","counterparty":"aws","due_date":"2026-03-20","confidence":"clear"},"id":"doc2","prev":"y"}
{"ts":"2026-03-18T00:00:00.000Z","source":"bank","type":"expense","data":{"amount":-300,"currency":"USD","invoice_id":"BILL-001","description":"Bill payment","confidence":"clear"},"id":"pay2","prev":"z"}
{"ts":"2026-03-10T00:00:00.000Z","source":"manual","type":"invoice","data":{"amount":120,"currency":"USD","direction":"issued","counterparty":"beta","confidence":"clear"},"id":"doc3","prev":"q"}
{"ts":"2026-03-12T00:00:00.000Z","source":"bank","type":"expense","data":{"amount":75,"currency":"USD","category":"software","confidence":"unclear"},"id":"rev1","prev":"w"}
EOF

POLICY_LINT="$DOCS_ROOT/policy-lint.json"
(cd "$DOCS_ROOT" && $CLI policy lint 2>&1) > "$POLICY_LINT"
grep -q '"status": "warn"' "$POLICY_LINT" || { echo "FAIL: policy lint should warn on incomplete policy"; exit 1; }
grep -q 'Revenue recognition' "$POLICY_LINT" || { echo "FAIL: policy lint should suggest missing sections"; exit 1; }

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

CONTEXT_DOCS="$DOCS_ROOT/context-docs.txt"
(cd "$DOCS_ROOT" && $CLI context 2026-03 2>&1) > "$CONTEXT_DOCS"
grep -q '"settlement_summary"' "$CONTEXT_DOCS" || { echo "FAIL: context should include settlement_summary"; exit 1; }
grep -q '"top_open_documents"' "$CONTEXT_DOCS" || { echo "FAIL: context should include top_open_documents"; exit 1; }
grep -q '"review_materiality"' "$CONTEXT_DOCS" || { echo "FAIL: context should include review_materiality"; exit 1; }
rm -rf "$DOCS_ROOT"

echo "books-resolution tests: ok"
