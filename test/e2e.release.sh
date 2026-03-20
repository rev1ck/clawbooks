#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
PACK_TARBALL=""
export npm_config_cache="$TMP_ROOT/.npm-cache"

cleanup() {
  if [[ -n "$PACK_TARBALL" && -f "$REPO_ROOT/$PACK_TARBALL" ]]; then
    rm -f "$REPO_ROOT/$PACK_TARBALL"
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

run_workflow() {
  local workdir="$1"
  shift
  local -a cli=("$@")

  mkdir -p "$workdir"

  (
    cd "$workdir"

    "${cli[@]}" init >/dev/null
    test -f ".books/program.md" || { echo "FAIL: init should create program.md"; exit 1; }

    "${cli[@]}" quickstart > quickstart.json
    grep -q '"command": "quickstart"' quickstart.json || { echo "FAIL: quickstart should identify itself"; exit 1; }

    "${cli[@]}" import scaffold statement-csv > import-scaffold.json
    test -f ".books/imports/statement-csv/mapper.mjs" || { echo "FAIL: scaffold should create mapper.mjs"; exit 1; }
    test -f ".books/imports/statement-csv/mapper.py" || { echo "FAIL: scaffold should create mapper.py"; exit 1; }
    test -f ".books/imports/statement-csv/statement-profile.json" || { echo "FAIL: scaffold should create statement profile"; exit 1; }

    cat > staged.jsonl <<'EOF'
{"ts":"2026-03-05T00:00:00.000Z","source":"statement_import","type":"income","data":{"amount":200,"currency":"USD","category":"sales","description":"client payment","confidence":"inferred","transaction_date":"2026-03-04","posting_date":"2026-03-05","source_doc":"statement.csv","source_row":"2","recorded_by":"e2e"}} 
{"ts":"2026-03-18T00:00:00.000Z","source":"statement_import","type":"expense","data":{"amount":-300,"currency":"USD","category":"software","description":"vendor payment","confidence":"inferred","transaction_date":"2026-03-17","posting_date":"2026-03-18","source_doc":"statement.csv","source_row":"3","recorded_by":"e2e"}} 
EOF

    cat > statement-profile.json <<'EOF'
{"statement_id":"stmt-e2e","source":"statement_import","currency":"USD","date_basis":"posting","statement_start":"2026-03-01","statement_end":"2026-03-31","opening_balance":1000,"closing_balance":900,"count":2,"debits":-300,"credits":200,"newest_first":false}
EOF

    "${cli[@]}" import check staged.jsonl --statement statement-profile.json --save-session --session-id e2e-session > import-check.json
    grep -q '"status": "ok"' import-check.json || { echo "FAIL: import check should pass"; exit 1; }
    test -f ".books/imports/sessions/e2e-session.json" || { echo "FAIL: import check should save import session sidecar"; exit 1; }
    "${cli[@]}" import sessions list > import-sessions.json
    grep -q '"import_session": "e2e-session"' import-sessions.json || { echo "FAIL: import sessions should list the saved session"; exit 1; }
    "${cli[@]}" import reconcile staged.jsonl --statement statement-profile.json > import-reconcile.json
    grep -q '"command": "import reconcile"' import-reconcile.json || { echo "FAIL: import reconcile should produce an artifact"; exit 1; }

    "${cli[@]}" record '{"source":"manual","type":"opening_balance","ts":"2026-03-01T00:00:00.000Z","data":{"amount":1000,"currency":"USD","account":"checking","category":"cash"}}' >/dev/null
    "${cli[@]}" batch < staged.jsonl >/dev/null

    "${cli[@]}" verify 2026-03 --balance 900 --opening-balance 1000 --currency USD > verify.json
    grep -q '"matches": true' verify.json || { echo "FAIL: verify should match opening + closing balance"; exit 1; }

    "${cli[@]}" reconcile 2026-03 --source statement_import --count 2 --debits -300 --credits 200 --opening-balance 1000 --closing-balance 900 --date-basis posting > reconcile.json
    grep -q '"status": "RECONCILED"' reconcile.json || { echo "FAIL: reconcile should succeed"; exit 1; }

    "${cli[@]}" review 2026-03 --confidence inferred > review.json
    grep -q '"needs_review": 2' review.json || { echo "FAIL: review should surface inferred items"; exit 1; }

    "${cli[@]}" review batch 2026-03 --out review-actions.jsonl --action confirm --confidence inferred --confirmed-by e2e-reviewer --notes staged-confirm > review-batch.json
    test -f review-actions.jsonl || { echo "FAIL: review batch should emit action file"; exit 1; }
    grep -q '"item_count": 2' review-batch.json || { echo "FAIL: review batch should emit both actions"; exit 1; }

    "${cli[@]}" batch < review-actions.jsonl >/dev/null

    "${cli[@]}" review 2026-03 > review-after.json
    grep -q '"needs_review": 0' review-after.json || { echo "FAIL: review queue should be cleared after confirms"; exit 1; }

    "${cli[@]}" summary 2026-03 > summary.json
    grep -q '"review_materiality"' summary.json || { echo "FAIL: summary should include review materiality"; exit 1; }

    "${cli[@]}" context 2026-03 --include-policy > context.txt
    grep -q '<policy>' context.txt || { echo "FAIL: context should inline policy when requested"; exit 1; }

    mkdir -p pack
    "${cli[@]}" pack 2026-03 --out ./pack >/dev/null
    test -f "./pack/summary.json" || { echo "FAIL: pack should create summary.json"; exit 1; }
    test -f "./pack/policy.md" || { echo "FAIL: pack should copy policy.md"; exit 1; }
  )
}

npm run build >/dev/null
run_workflow "$TMP_ROOT/built" node "$REPO_ROOT/build/cli.js"

(
  cd "$REPO_ROOT"
  npm pack >/dev/null
)
PACK_TARBALL="$(cd "$REPO_ROOT" && ls -1t clawbooks-*.tgz | head -n 1)"
test -n "$PACK_TARBALL" || { echo "FAIL: npm pack did not produce a tarball"; exit 1; }
PACK_DIR="$TMP_ROOT/packed-install"
mkdir -p "$PACK_DIR"
(
  cd "$PACK_DIR"
  npm install "$REPO_ROOT/$PACK_TARBALL" >/dev/null
)
run_workflow "$TMP_ROOT/packed-run" "$TMP_ROOT/packed-install/node_modules/.bin/clawbooks"

echo "e2e.release.sh: ok"
