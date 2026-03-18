#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { ensureBooksDir, requireBooks, resolveBooks } from "./books.js";
import { cmdPolicy } from "./commands/policy.js";
import { cmdWhere } from "./commands/where.js";
import { cmdDoctor } from "./commands/doctor.js";
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

const HELP = `clawbooks — accounting by inference, not by engine.

Setup:
  init    [--books DIR] [--example NAME]
                                    Create a books directory with ledger + starter policy

Data commands:
  record  <json>              Append one event to the ledger
  batch                       Append JSONL events from stdin
  log     [flags]             Print ledger events
  context [period] [flags]    Print compact policy + snapshot + events (use --verbose for full payloads)
  documents [period] [flags]  Show neutral document settlement and aging views
  policy  [lint] [--path]     Print policy.md, lint it, or print the path
  where                       Show resolved books, ledger, and policy paths
  doctor                      Show setup diagnostics + agent bootstrap guidance
  quickstart                  Alias for doctor with first-run guidance
  stats                       Ledger summary

Analysis commands:
  verify    [period] [--source S] [--balance N] [--currency C]
                                           Integrity + chain + balance check + duplicate detection
  reconcile [period] --source S [flags]    Compare expected vs actual totals
  review    [period] [--source S]          Show items needing classification review
  summary   [period] [--source S]          Pre-computed aggregates for reports
  snapshot  [period] [--save]              Compute period snapshot (balances, movement summary)
  assets    [--category C] [--life N] [--as-of DATE]
                                           Asset register (capitalize-flag based) with depreciation
  compact   <period> [--archive PATH]     Archive old events, save snapshot, shrink ledger
  pack      [period] [--source S] [--out DIR]
                                           Generate audit pack (CSVs + JSON + policy)

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

Sign convention:
  Outflow types (expense, tax_payment, owner_draw, fee): amount stored as negative
  Inflow types: amount stored as positive
  Document types (invoice, bill): sign based on data.direction (issued=positive, received=negative)
  Meta types (snapshot, reclassify, opening_balance, correction, confirm): sign not enforced
  Asset events (disposal, write_off, impairment): sign not enforced

Setup:
  init    [--books DIR] [--example NAME]
                                    Create a books directory with ledger + starter policy

Global flags:
  --books <dir>                     Use a specific books directory

Init flags:
  --example <name>                  Policy seed: default, simple, complex
  --list-examples                   Print available policy examples and exit

Environment:
  CLAWBOOKS_BOOKS     Books directory (default: auto-detected .books/)
  CLAWBOOKS_LEDGER    Override ledger path (takes priority over books dir)
  CLAWBOOKS_POLICY    Override policy path (takes priority over books dir)

Books resolution order:
  1. CLAWBOOKS_LEDGER / CLAWBOOKS_POLICY env vars (direct file paths)
  2. CLAWBOOKS_BOOKS env var (books directory)
  3. --books <dir> flag (books directory)
  4. Walk up from CWD looking for .books/ containing ledger.jsonl or policy.md
  5. Bare ./ledger.jsonl in CWD (backward compat)
  6. Auto-create .books/ on first write command

Bootstrap behavior:
  New books are seeded with a policy example. Edit policy.md to match your entity and jurisdiction.

Examples:
  clawbooks where
  clawbooks doctor
  clawbooks quickstart
  clawbooks init
  clawbooks init --list-examples
  clawbooks init --example simple
  clawbooks init --example complex
  clawbooks init --books .books-personal
  clawbooks record '{"source":"bank","type":"expense","data":{"amount":100,"currency":"USD","description":"test"}}'
  cat events.jsonl | clawbooks batch
  clawbooks --books .books-personal summary 2026-03
  clawbooks log --last 10 -S stripe
  clawbooks documents 2026-03 --status partial
  clawbooks policy lint
  clawbooks context 2026-03 --include-policy
  clawbooks verify 2026-03 --balance 153869.05 --currency USD
  clawbooks pack 2026-03 --out ./march-pack

Multi-entity:
  clawbooks init --books .books-personal
  clawbooks --books .books-personal record '...'
  CLAWBOOKS_BOOKS=.books-personal clawbooks summary 2026-03

Agent workflow:
  1. Agent runs: clawbooks context 2026-03
  2. Agent reads the output and the policy
  3. Agent reasons over it and answers your question
  4. Agent runs: clawbooks record '...' to write new events
  5. Agent runs: clawbooks verify + reconcile to check integrity
  6. Agent runs: clawbooks summary to generate reports
  7. Agent runs: clawbooks snapshot --save to persist period summary
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
  case "doctor":
  case "quickstart":
    cmdDoctor({
      booksDir: BOOKS_DIR,
      ledgerPath: LEDGER,
      policyPath: POLICY,
      resolution: BOOKS_RESOLUTION,
    }); break;
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
