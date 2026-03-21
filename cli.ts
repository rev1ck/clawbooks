#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { ensureBooksDir, requireBooks, resolveBooks } from "./books.js";
import { cmdPolicy } from "./commands/policy.js";
import { cmdWhere } from "./commands/where.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdQuickstart } from "./commands/quickstart.js";
import { cmdWorkflow } from "./commands/workflow.js";
import { cmdVersion } from "./commands/version.js";
import { cmdDocuments } from "./commands/documents.js";
import { cmdSummary } from "./commands/summary.js";
import { cmdContext } from "./commands/context.js";
import { cmdLog } from "./commands/log.js";
import { cmdStats } from "./commands/stats.js";
import { cmdVerify } from "./commands/verify.js";
import { cmdReconcile } from "./commands/reconcile.js";
import { cmdReview } from "./commands/review.js";
import { cmdSnapshot } from "./commands/snapshot.js";
import { cmdCompact } from "./commands/compact.js";
import { cmdInit } from "./commands/init.js";
import { cmdRecord } from "./commands/record.js";
import { cmdBatch } from "./commands/batch.js";
import { cmdAssets } from "./commands/assets.js";
import { cmdPack } from "./commands/pack.js";
import { cmdImport } from "./commands/import.js";
import { CLI_VERSION } from "./version.js";

// Parse --books global flag from argv before command dispatch
function extractBooksFlag(argv: string[]): { booksFlag?: string; rest: string[] } {
  const rest: string[] = [];
  let booksFlag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--books" && i + 1 < argv.length) {
      booksFlag = argv[i + 1];
      i++;
    } else {
      rest.push(argv[i]);
    }
  }
  return { booksFlag, rest };
}

const { booksFlag, rest: argv } = extractBooksFlag(process.argv.slice(2));
const { ledger: LEDGER, policy: POLICY, booksDir: BOOKS_DIR, resolution: BOOKS_RESOLUTION } = resolveBooks(booksFlag);

// --- Helpers ---

function stdin(): Promise<string> {
  return new Promise((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => resolve(d));
  });
}

// --- Help ---

const HELP = `clawbooks v${CLI_VERSION} — financial memory for agents.

Clawbooks has 3 core parts:
  program.md    Operating manual for the agent
  policy.md     Accounting policy for the current books
  ledger.jsonl  Append-only financial record

Core reference:
  event-schema.md  Canonical event envelope and schema evolution rules

Mental model:
  The agent reads program.md to learn how clawbooks works.
  The agent reads policy.md to learn how the current books should be accounted for.
  The agent reads event-schema.md to learn the canonical event envelope.
  The ledger stores facts. The agent does the accounting.
  Outputs are either policy_grounded or provisional.
  Provisional runs are exploratory; they should not be presented as final accounting.

First run:
  1. clawbooks quickstart
  2. Read program.md
  3. Read policy.md
  4. clawbooks workflow ack --program --policy
  5. Import normalized events with record/batch
  6. Run verify + reconcile
  7. Use summary, context, documents, assets, and pack to produce reports, checks, and audit-ready outputs

Setup:
  init        [--books DIR] [--example NAME]
                                      Create a books directory with ledger + starter policy
  import      scaffold <kind> [flags]
                                      Emit editable import mapper templates (mjs + python)
  import      check <events.jsonl> [flags]
                                      Validate a staged import file before append
  import      mappings <action> [flags]
                                      Surface or validate optional vendor mapping hints
  import      sessions <action> [flags]
                                      Inspect saved import-session sidecars
  import      reconcile <events.jsonl> [flags]
                                      Build a statement reconciliation artifact
  where                               Show resolved books, ledger, and policy paths
  quickstart                          Explain the operating model, key files, and first-run flow
  doctor                              Show setup diagnostics and policy readiness
  workflow  [status|ack]              Record or inspect workflow acknowledgment state
  version    [--latest]               Print the installed version or compare to npm

Import:
  record  <json>              Append one event to the ledger
  batch                       Append JSONL events from stdin
  import scaffold --list      List available import scaffolds
  import check staged.jsonl   Check a staged JSONL import against explicit expectations
  import mappings suggest     Suggest recurring vendor hints from ledger history
  import sessions list        List saved import-session records

Inspect:
  log     [flags]             Print ledger events
  stats                       Ledger summary
  policy  [lint] [--path]     Print policy.md, lint it, or print the path
  policy  --list-examples     List bundled policy examples
  policy  --example NAME      Print a bundled policy example without overwriting policy.md
  documents [period] [flags]  Show neutral document settlement and aging views

Report and analyze:
  summary   [period] [flags]  Pre-computed aggregates for reports
  context   [period] [flags]  Print policy-aware snapshot + events for event-level reasoning
  review    [period] [flags]  Show items needing classification review
  review    batch [period]    Generate bulk append-only review actions as JSONL
  reconcile [period] --source S [flags]
                              Compare expected vs actual totals
  verify    [period] [flags]  Integrity + chain + balance check + duplicate detection
  assets    [flags]           Asset register and depreciation view
  pack      [period] [flags]  Generate audit pack (CSVs + JSON + policy)

Maintenance:
  snapshot  [period] [--save] Compute or save a derived checkpoint event
  compact   <period> [--archive PATH]
                              Archive old events, save snapshot, shrink ledger

Important terms:
  program.md   Operating manual for the agent
  policy.md    Accounting policy for the current books
  event-schema.md Canonical event envelope and schema evolution reference
  ledger.jsonl Append-only financial record
  policy_grounded Output produced after current-run workflow grounding
  provisional  Exploratory output produced without full workflow grounding
  snapshot     Saved derived checkpoint in the ledger; not the source of truth

Quick examples:
  clawbooks quickstart
  clawbooks doctor
  clawbooks workflow ack --program --policy
  clawbooks workflow ack --program --policy --classification-basis policy_explicit
  clawbooks workflow status
  clawbooks version
  clawbooks version --latest
  clawbooks init
  clawbooks import scaffold --list
  clawbooks import scaffold statement-csv
  clawbooks import check staged.jsonl --statement statement-profile.json --save-session
  clawbooks import mappings suggest --source statement_import
  clawbooks import mappings check staged.jsonl --mappings .books/imports/statement-csv/vendor-mappings.json
  clawbooks import reconcile staged.jsonl --statement statement-profile.json
  clawbooks review batch 2026-03 --out review-actions.jsonl --action confirm --confidence inferred
  clawbooks policy --path
  clawbooks policy lint
  clawbooks policy --list-examples
  clawbooks policy --example simple
  clawbooks summary 2026-03
  clawbooks context 2026-03 --include-policy
  clawbooks verify 2026-03 --balance 153869.05 --currency USD
  clawbooks pack 2026-03 --out ./march-pack
  clawbooks pack 2026-03 --out ./march-pack --allow-provisional

Outcome surface:
  Use clawbooks to build P&L, balance sheet, cash flow, receivable/payable views,
  tax cuts, asset registers, reconciliations, audit packs, and custom period analysis.

Recommended first session:
  clawbooks init
  clawbooks quickstart
  clawbooks import scaffold statement-csv
  clawbooks import check staged.jsonl --statement statement-profile.json --save-session

Setup flags:
  --books <dir>               Use a specific books directory

Init flags:
  --example <name>            Policy seed: default, simple, complex
  --list-examples             Print available policy examples and exit

Common flags:
  --after  <ISO date>         Events after this date
  --before <ISO date>         Events before this date
  --source / -S <name>        Filter by source
  --type   / -T <name>        Filter by type
  --verbose                   Print full raw payloads where supported
  --include-policy            Inline the full policy in context output
  --last   <N>                Last N events (log only, default 20)

Reconcile flags:
  --count    <N>              Expected event count
  --debits   <N>              Expected debits total
  --credits  <N>              Expected credits total
  --opening-balance <N>       Expected opening balance for statement-style checks
  --closing-balance <N>       Expected closing balance after period movement
  --currency <C>              Filter to a specific currency
  --date-basis <kind>         ledger, transaction, or posting
  --gaps                      Detect date gaps >7 days

Review flags:
  --confidence <list>         Comma-separated confidence filter such as inferred,unclear
  --min-magnitude <N>         Only show items whose absolute amount is at least N
  --limit <N>                 Limit the number of returned review items
  --group-by <field>          category, source, or type
  --allow-provisional         Acknowledge that the run is exploratory rather than policy-grounded
  --out <PATH>                Output path for review batch
  --action <kind>             confirm or reclassify for review batch
  --confirmed-by <NAME>       Confirmer label for bulk confirm files
  --notes <TEXT>              Notes for bulk confirm files
  --new-category <CAT>        Target category for bulk reclassify files

Workflow flags:
  --classification-basis <kind>
                              policy_explicit, policy_guided, heuristic_pattern,
                              manual_operator, mixed, or unknown
  --allow-provisional         Explicitly allow exploratory output where supported

Import check notes:
  --statement <file>          Load a statement-profile JSON with explicit expectations
                              such as period, balances, row count, and date basis
  --save-session              Save a sidecar import session JSON for operator traceability
  --mappings <file>           Use an explicit vendor-mappings.json file for factual consistency checks
                              If omitted, clawbooks checks scaffold-local paths and .books/vendor-mappings.json

Vendor mapping notes:
  Vendor mappings are optional operator-maintained hints for recurring descriptions.
  They do not override policy.md and are never applied silently by the CLI.

Policy lint notes:
  policy lint emits severity-tagged checks and workflow coverage signals.
  It is advisory and heuristic, not a policy parser or rules engine.

Verify flags:
  --balance  <N>              Cross-check net balance against expected value
  --opening-balance <N>       Treat expected balance as opening balance + period movement
  --currency <C>              Filter balance check to a specific currency

Period format:
  2026                        Whole year
  2026-03                     Single month
  2026-01/2026-06-30          Date range

Environment:
  CLAWBOOKS_BOOKS     Books directory (default: auto-detected .books/)
  CLAWBOOKS_LEDGER    Override ledger path (takes priority over books dir)
  CLAWBOOKS_POLICY    Override policy path (takes priority over books dir)
`;

function commandHelp(cmd?: string, args: string[] = []): string | null {
  const sub = args[0];
  const key = cmd === "import" && sub === "check" ? "import-check"
    : cmd === "import" && sub === "scaffold" ? "import-scaffold"
    : cmd === "import" && sub === "mappings" ? "import-mappings"
    : cmd === "import" && sub === "sessions" ? "import-sessions"
    : cmd === "import" && sub === "reconcile" ? "import-reconcile"
    : cmd === "review" && sub === "batch" ? "review-batch"
    : cmd ?? "";

  const helps: Record<string, string> = {
    init: `Usage: clawbooks init [--books DIR] [--example NAME] [--list-examples]

Create a books directory with ledger.jsonl, policy.md, and program.md.

Examples:
  clawbooks init
  clawbooks init --books .books-personal
  clawbooks init --example simple`,
    "import-scaffold": `Usage: clawbooks import scaffold <statement-csv|generic-csv|fills-csv|manual-batch> [--out DIR]

Emit editable mapper templates. For statement-csv, clawbooks also emits:
  - statement-profile.json
  - vendor-mappings.json

Scaffold output also reports whether the current run is policy_grounded or provisional.

Examples:
  clawbooks import scaffold statement-csv
  clawbooks import scaffold generic-csv --out ./imports/generic`,
    "import-check": `Usage: clawbooks import check <events.jsonl> [--statement profile.json] [--mappings PATH] [--save-session] [--session-id ID] [--classification-basis BASIS]

Validate staged JSONL before append. --statement loads explicit expectations such as:
  - period coverage
  - opening/closing balance
  - row count
  - date basis

If a vendor mappings file is present, import check surfaces coverage and consistency signals.
Saved import sessions capture grounding state such as classification_basis, program_hash, policy_hash, and workflow acknowledgment.
Import full source coverage when practical, then cut periods later in summary/verify/review.

Examples:
  clawbooks import check staged.jsonl --statement statement-profile.json
  clawbooks import check staged.jsonl --statement statement-profile.json --save-session
  clawbooks import check staged.jsonl --statement statement-profile.json --classification-basis heuristic_pattern`,
    "import-mappings": `Usage: clawbooks import mappings <suggest|check> [events.jsonl] [--mappings PATH] [--min-occurrences N] [--source S] [--out PATH]

Work with optional vendor-mappings.json files as factual recurring-description hints.

Examples:
  clawbooks import mappings suggest --source statement_import
  clawbooks import mappings check staged.jsonl --mappings .books/imports/statement-csv/vendor-mappings.json`,
    "import-sessions": `Usage: clawbooks import sessions <list|show> [session-id|latest]

Inspect saved import-session sidecars written by \`clawbooks import check --save-session\`.

Examples:
  clawbooks import sessions list
  clawbooks import sessions show latest`,
    "import-reconcile": `Usage: clawbooks import reconcile <events.jsonl> --statement profile.json [--out PATH] [--date-basis ledger|transaction|posting] [--currency C]

Build a statement reconciliation artifact that compares the staged import, current ledger slice, and declared statement expectations.

Examples:
  clawbooks import reconcile staged.jsonl --statement statement-profile.json
  clawbooks import reconcile staged.jsonl --statement statement-profile.json --out reconcile-artifact.json`,
    review: `Usage: clawbooks review [period] [--confidence LIST] [--min-magnitude N] [--limit N] [--group-by category|source|type] [--allow-provisional]

Show items needing review. By default, review includes inferred, unclear, and unset confidence items and sorts by materiality.
Review echoes the resolved scope and the next best command for working the queue.
Use --allow-provisional only when you intentionally want exploratory output before workflow grounding.

Examples:
  clawbooks review 2026-03
  clawbooks review 2026-03 --confidence inferred,unclear --group-by category`,
    "review-batch": `Usage: clawbooks review batch [period] --out PATH --action confirm|reclassify [flags]

Generate append-only JSONL review actions for the visible queue. Inspect the file before appending with clawbooks batch.

Examples:
  clawbooks review batch 2026-03 --out review-actions.jsonl --action confirm --confidence inferred
  clawbooks review batch 2026-03 --out reclassify.jsonl --action reclassify --confidence unclear --new-category software`,
    summary: `Usage: clawbooks summary [period] [flags] [--allow-provisional]

Produce report aggregates, report sections, settlement summaries, review materiality, and coverage metadata.
Use --allow-provisional only when you intentionally want exploratory output before workflow grounding.

Examples:
  clawbooks summary 2026-03
  clawbooks summary 2026-01/2026-06-30`,
    policy: `Usage: clawbooks policy [lint] [--path] [--list-examples] [--example NAME]

Print the current policy, lint it, or inspect bundled starter examples.

Examples:
  clawbooks policy
  clawbooks policy lint
  clawbooks policy --example simple`,
    reconcile: `Usage: clawbooks reconcile [period] --source S [--count N] [--debits N] [--credits N] [--opening-balance N] [--closing-balance N] [--date-basis ledger|transaction|posting]

Compare imported totals to explicit expectations.

Examples:
  clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --credits 14500
  clawbooks reconcile 2026-03 --source bank --opening-balance 45000 --closing-balance 46250 --date-basis posting`,
    verify: `Usage: clawbooks verify [period] [--balance N] [--opening-balance N] [--currency C]

Run integrity, duplicate, sign, and balance checks on the ledger.
Verify echoes the resolved scope so period handling is explicit.

Examples:
  clawbooks verify 2026-03
  clawbooks verify 2026-03 --balance 900 --opening-balance 1000 --currency USD`,
    quickstart: `Usage: clawbooks quickstart

Explain the operating model, resolved core files, workflow state, and recommended first-run workflow.

Example:
  clawbooks quickstart`,
    workflow: `Usage: clawbooks workflow [status|ack] [--program] [--policy] [--agent NAME] [--operator NAME] [--classification-basis BASIS] [--source-docs a,b,c]

Record or inspect workflow acknowledgment state for the current run.
Use workflow ack after reading program.md and policy.md.

Examples:
  clawbooks workflow status
  clawbooks workflow ack --program --policy
  clawbooks workflow ack --program --policy --classification-basis policy_explicit`,
    doctor: `Usage: clawbooks doctor

Show setup diagnostics, policy readiness, import/review readiness, and operator warnings.

Example:
  clawbooks doctor`,
    context: `Usage: clawbooks context [period] [--include-policy] [--verbose] [--allow-provisional]

Print policy-aware context for reasoning and reporting.
Use --allow-provisional only when you intentionally want exploratory output before workflow grounding.

Examples:
  clawbooks context 2026-03
  clawbooks context 2026-03 --include-policy`,
    record: `Usage: clawbooks record '<json>' [--classification-basis BASIS] [--allow-provisional]

Append one event to the ledger and surface the run-level grounding state.

Examples:
  clawbooks record '{"source":"bank","type":"income","data":{"amount":500,"currency":"USD"}}'
  clawbooks record '{"source":"manual","type":"expense","data":{"amount":25,"currency":"USD"}}' --classification-basis manual_operator`,
    batch: `Usage: clawbooks batch [--classification-basis BASIS] [--allow-provisional]

Append JSONL events from stdin and surface the run-level grounding state.

Examples:
  cat events.jsonl | clawbooks batch
  cat events.jsonl | clawbooks batch --classification-basis manual_operator`,
    documents: `Usage: clawbooks documents [period] [--as-of ISO_DATE]

Show neutral settlement, aging, and document status views.

Example:
  clawbooks documents 2026-03 --as-of 2026-03-31T00:00:00.000Z`,
    pack: `Usage: clawbooks pack [period] [--out DIR] [--allow-provisional]

Generate an audit pack with CSVs, JSON, and the applied policy.
Pack refuses provisional runs unless you pass --allow-provisional.

Examples:
  clawbooks pack 2026-03 --out ./march-pack
  clawbooks pack 2026-03 --out ./march-pack --allow-provisional`,
  };

  return helps[key] ?? null;
}

// --- Dispatch ---

const WRITE_COMMANDS = new Set(["record", "batch", "init", "snapshot", "compact"]);
const READ_COMMANDS = new Set(["log", "context", "documents", "policy", "stats", "verify", "reconcile", "review", "summary", "assets", "pack", "workflow"]);

const [cmd, ...args] = argv;

if (args.includes("--help") || args.includes("-h")) {
  const help = commandHelp(cmd, args.filter((arg) => arg !== "--help" && arg !== "-h"));
  console.log(help ?? HELP);
  process.exit(0);
}

// For write commands (except init), auto-create .books/ if needed
if (WRITE_COMMANDS.has(cmd) && cmd !== "init") {
  // snapshot --save is a write; snapshot without --save is a read
  if (cmd !== "snapshot" || args.includes("--save")) {
    ensureBooksDir(BOOKS_DIR, LEDGER, POLICY);
  } else {
    requireBooks(LEDGER);
  }
} else if (READ_COMMANDS.has(cmd)) {
  requireBooks(LEDGER);
}

if (cmd === "workflow") {
  if (args[0] === "ack") ensureBooksDir(BOOKS_DIR, LEDGER, POLICY);
  else requireBooks(LEDGER);
}

switch (cmd) {
  case "init":      cmdInit(args, { booksFlag }); break;
  case "record":    cmdRecord(args, LEDGER); break;
  case "batch":     cmdBatch(args, await stdin(), LEDGER); break;
  case "import":    cmdImport(args, { booksDir: BOOKS_DIR, ledgerPath: LEDGER }); break;
  case "log":       cmdLog(args, LEDGER); break;
  case "context":   cmdContext(args, {
    ledgerPath: LEDGER,
    policyPath: POLICY,
    policyText: existsSync(POLICY) ? readFileSync(POLICY, "utf-8") : "No policy.md found.",
  }); break;
  case "documents": cmdDocuments(args, LEDGER); break;
  case "policy":    cmdPolicy(args, POLICY); break;
  case "where":     cmdWhere({
    booksDir: BOOKS_DIR,
    ledgerPath: LEDGER,
    policyPath: POLICY,
    resolution: BOOKS_RESOLUTION,
  }); break;
  case "quickstart":
    cmdQuickstart({
      booksDir: BOOKS_DIR,
      ledgerPath: LEDGER,
      policyPath: POLICY,
      resolution: BOOKS_RESOLUTION,
    }); break;
  case "workflow":
    cmdWorkflow(args, {
      booksDir: BOOKS_DIR,
      policyPath: POLICY,
    }); break;
  case "doctor":
    cmdDoctor({
      booksDir: BOOKS_DIR,
      ledgerPath: LEDGER,
      policyPath: POLICY,
      resolution: BOOKS_RESOLUTION,
    }); break;
  case "version":   cmdVersion(args); break;
  case "stats":     cmdStats(LEDGER); break;
  case "verify":    cmdVerify(args, LEDGER); break;
  case "reconcile": cmdReconcile(args, LEDGER); break;
  case "review":    cmdReview(args, LEDGER); break;
  case "summary":   cmdSummary(args, LEDGER); break;
  case "snapshot":  cmdSnapshot(args, LEDGER); break;
  case "assets":    cmdAssets(args, LEDGER); break;
  case "compact":   cmdCompact(args, LEDGER); break;
  case "pack":      cmdPack(args, { booksDir: BOOKS_DIR ?? undefined, ledgerPath: LEDGER, policyPath: POLICY }); break;
  default:          console.log(HELP);
}
