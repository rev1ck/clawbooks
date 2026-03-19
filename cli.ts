#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { ensureBooksDir, requireBooks, resolveBooks } from "./books.js";
import { cmdPolicy } from "./commands/policy.js";
import { cmdWhere } from "./commands/where.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdQuickstart } from "./commands/quickstart.js";
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

First run:
  1. clawbooks quickstart
  2. Read program.md
  3. Read policy.md
  4. Import normalized events with record/batch
  5. Run verify + reconcile
  6. Use summary, context, documents, assets, and pack to produce reports, checks, and audit-ready outputs

Setup:
  init        [--books DIR] [--example NAME]
                                      Create a books directory with ledger + starter policy
  where                               Show resolved books, ledger, and policy paths
  quickstart                          Explain the operating model, key files, and first-run flow
  doctor                              Show setup diagnostics and policy readiness
  version    [--latest]               Print the installed version or compare to npm

Import:
  record  <json>              Append one event to the ledger
  batch                       Append JSONL events from stdin

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
  snapshot     Saved derived checkpoint in the ledger; not the source of truth

Quick examples:
  clawbooks quickstart
  clawbooks doctor
  clawbooks version
  clawbooks version --latest
  clawbooks init
  clawbooks policy --path
  clawbooks policy --list-examples
  clawbooks policy --example simple
  clawbooks summary 2026-03
  clawbooks context 2026-03 --include-policy
  clawbooks verify 2026-03 --balance 153869.05 --currency USD
  clawbooks pack 2026-03 --out ./march-pack

Outcome surface:
  Use clawbooks to build P&L, balance sheet, cash flow, receivable/payable views,
  tax cuts, asset registers, reconciliations, audit packs, and custom period analysis.

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
  --currency <C>              Filter to a specific currency
  --gaps                      Detect date gaps >7 days

Verify flags:
  --balance  <N>              Cross-check net balance against expected value
  --opening-balance <N>       Treat expected balance as opening balance + period movement
  --currency <C>              Filter balance check to a specific currency

Period format:
  2026-03                     Single month
  2026-01/2026-06-30          Date range

Environment:
  CLAWBOOKS_BOOKS     Books directory (default: auto-detected .books/)
  CLAWBOOKS_LEDGER    Override ledger path (takes priority over books dir)
  CLAWBOOKS_POLICY    Override policy path (takes priority over books dir)
`;

// --- Dispatch ---

const WRITE_COMMANDS = new Set(["record", "batch", "init", "snapshot", "compact"]);
const READ_COMMANDS = new Set(["log", "context", "documents", "policy", "stats", "verify", "reconcile", "review", "summary", "assets", "pack"]);

const [cmd, ...args] = argv;

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

switch (cmd) {
  case "init":      cmdInit(args, { booksFlag }); break;
  case "record":    cmdRecord(args, LEDGER); break;
  case "batch":     cmdBatch(await stdin(), LEDGER); break;
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
