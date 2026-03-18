<p align="center">
  <img src="./logo.png" alt="clawbooks logo" width="180" align="center">
</p>

<h1 align="center">clawbooks</h1>

<p align="center"><strong>Financial memory for agents.</strong></p>

<p align="center">Append-only ledger • Plain-English policy • Agent-native accounting CLI</p>

Clawbooks is an append-only ledger, a plain-English accounting policy, and a CLI.
Your agent reads the data, reads the policy, and does the accounting.

No rules engine. No SDK. No framework.

**Tiny core. Zero runtime dependencies.**

Bring CSVs, Stripe exports, exchange fills, receipts, PDFs, or copied transaction text.
Your agent reads the source, applies `policy.md`, writes normalized ledger events into clawbooks, and produces statements, summaries, and audit packs from the same record.

## The loop

```text
Raw inputs
bank CSVs / Stripe exports / receipts / PDFs / exchange fills / copied text
  ->
Agent ingestion
reads the source + applies policy.md + writes normalized ledger events
  ->
Clawbooks ledger
append-only records + snapshots + verification + context + packs
  ->
Agent outputs
P&L / balance sheet / cash flow / tax views / asset register / audit-ready working files
  ->
Policy improvement
you refine policy.md and the next ingestion/reporting cycle gets better
```

## Why

Most accounting software assumes the product should contain the accounting logic.
Clawbooks takes the opposite view:

- the ledger stores facts
- the policy states the rules in plain English
- the agent does the reasoning

That makes clawbooks useful anywhere an agent can read files and run shell commands.

## What you get

- Append-only JSONL ledger with hash chaining
- Plain-English policy file instead of embedded bookkeeping logic
- CLI commands for recording, reviewing, reconciling, compacting, and packaging records
- Structured `context` output designed for agent reasoning
- Zero runtime dependencies

## How ingestion works

Clawbooks does not ship source-specific import logic.
That is deliberate.

Your agent is the importer:

- bring raw inputs in whatever form you already have
- the agent reads them and applies `policy.md`
- the agent converts them into normalized ledger events
- clawbooks stores the canonical record

This keeps ingestion programmable by policy instead of hardcoded per integration.

## What the agent can produce

With `context`, `summary`, `verify`, `reconcile`, `assets`, and `pack`, your agent can prepare:

- profit and loss statements
- balance sheets
- cash flow summaries
- categorized tax views
- asset registers and depreciation views
- audit-ready working packs

Clawbooks supplies durable memory, verification, and repeatable tooling.
The agent does the accounting work on top of that foundation.

For statement-like sources, the intended operator loop is:

- sort the source into chronological order if needed
- capture opening balance, closing balance, expected count, debits, and credits
- import normalized events
- run `reconcile` against the source totals
- run `verify --balance ... --opening-balance ...` when statement balances are available

## Boundaries

You and your agent:

- write and refine `policy.md`
- ingest source documents and convert them into ledger events
- interpret edge cases
- review outputs and improve the policy over time

clawbooks:

- stores append-only financial records
- preserves snapshots and audit history
- provides structured context for the agent
- verifies integrity and reconciliation surfaces
- packages records for downstream review and reporting

As `policy.md` gets better, your ingestion, classification, and reporting get better too.

## Example

```text
You: "What's my P&L for March?"

Agent runs:    clawbooks context 2026-03
Agent reads:   policy + summary + events
Agent reasons: applies the policy to the records
Agent replies: "Revenue: $1,700. Expenses: $475. Net: $1,225."
```

There is no accounting engine. In clawbooks, the agent is the engine.

## Install

```bash
npm install -g clawbooks
clawbooks --help
clawbooks init
```

`clawbooks init` creates a `.books/` directory with:
- `ledger.jsonl` for append-only records
- `policy.md` seeded from a bundled policy example

Edit `.books/policy.md` before relying on reports. The seeded policy is a starting point: you or your agent should tailor it to the entity, basis, jurisdiction, and reporting rules.

Use a specific bundled example when it fits better:

```bash
clawbooks init --example default
clawbooks init --example simple
clawbooks init --example complex
```

- `default`: generic business policy
- `simple`: simpler cash-basis operating business
- `complex`: accrual/trading-heavy example

## Local setup

```bash
git clone https://github.com/rev1ck/clawbooks.git
cd clawbooks
npm install
npm run build
node build/cli.js init
```

For multiple entities, use separate books directories:

```bash
clawbooks init --books .books-company
clawbooks init --books .books-personal
clawbooks init --books .books-company --example simple
clawbooks --books .books-company summary 2026-03
```

## Where To Keep `.books/`

Two patterns are supported and worth documenting explicitly:

- Project-local: keep `.books/` at the repo root when the ledger belongs to one codebase or client folder.
- Home-managed: keep entity books under `~/.clawbooks/<entity>/` when using the global npm install across multiple unrelated entities.

Examples:

```bash
clawbooks init                          # project-local .books/
clawbooks init --books ~/.clawbooks/acme
CLAWBOOKS_BOOKS=~/.clawbooks/acme clawbooks summary 2026-03
clawbooks where
```

Use `clawbooks where` to confirm which books directory, ledger, and policy the CLI resolved before importing or reporting.
Use `clawbooks doctor` when starting in an unfamiliar folder or global-install workflow. It reports the resolved books paths, packaged support files, and the recommended next steps for an agent.

## How it works

Clawbooks stores financial events and outputs accounting context.
The important command is `clawbooks context`: it prints a compact working envelope with metadata, instructions, a high-signal summary, snapshot data when present, and event rows for transaction-level reasoning. The policy remains the source of truth on disk and is referenced by path. Use `--verbose` when you want the full internal summary and raw event payloads, or `--include-policy` to inline the policy text.

## Commands

```bash
# Bootstrap
clawbooks where
clawbooks doctor
clawbooks quickstart
clawbooks init
clawbooks init --list-examples
clawbooks init --example simple
clawbooks init --example complex
clawbooks init --books .books-personal

# Write events
clawbooks record '{"source":"stripe","type":"income","data":{"amount":500,"currency":"USD"}}'
cat events.jsonl | clawbooks batch

# Read events
clawbooks log --last 10
clawbooks log --source stripe --after 2026-03-01
clawbooks stats

# Load context for the agent
clawbooks context 2026-03
clawbooks context 2026-03 --verbose
clawbooks context 2026-03 --include-policy
clawbooks context --after 2026-01-01
clawbooks policy
clawbooks policy lint
clawbooks policy --path
clawbooks documents 2026-03
clawbooks documents 2026-03 --status partial

# Analysis
clawbooks verify 2026-03                            # integrity + chain + duplicates
clawbooks verify --balance 50000 --currency USD     # cross-check closing balance against period movement
clawbooks verify 2026-03 --balance 50000 --opening-balance 45000 --currency USD
                                                    # cross-check opening + movement = closing
clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --gaps
clawbooks review --source bank                      # items needing classification
clawbooks summary 2026-03                           # aggregates + report-oriented sections
clawbooks snapshot 2026-03 --save                   # persist period snapshot
clawbooks assets --as-of 2026-03-31                 # asset register + depreciation

# Maintenance
clawbooks compact 2025-12                           # archive old events, shrink ledger
clawbooks pack 2026-03 --out ./march-pack           # generate audit pack (CSVs + JSON)

# Print the policy
clawbooks policy
clawbooks policy --path
```

Use `--books <dir>` or `CLAWBOOKS_BOOKS=<dir>` to switch entities. Read-only commands error with a clear message if no books are found; write commands auto-create `.books/` when needed. After `init`, clawbooks confirms the created folder, ledger path, policy path, and the selected example so the user can verify the setup immediately.

## The context command

This is the core command. It prints a `context` envelope for the requested period:

- `metadata` explains the requested and effective window, whether a snapshot was used, and what kinds of records are present
- `instructions` tells the agent how to interpret snapshot plus events
- `summary` provides a compact management view before the event rows, including movement summary, settlement summary, receivable/payable candidates, review materiality, correction summary, and top categories
- `snapshot` is the starting state, when available
- `events` contains compact event rows by default; use `--verbose` for full raw records

```bash
$ clawbooks context 2026-03

<context schema="clawbooks.context.v2">
<metadata>
{
  "schema_version": "clawbooks.context.v2",
  "generated_at": "2026-03-31T12:00:00.000Z",
  "ledger_path": "/path/to/.books/ledger.jsonl",
  "policy_path": "/path/to/.books/policy.md",
  "requested_window": {"after":"2026-03-01T00:00:00.000Z","before":"2026-03-31T23:59:59.999Z"},
  "effective_window": {"after":"2026-03-01T00:00:00.000Z","before":"2026-03-31T23:59:59.999Z"},
  "snapshot": {"used": true, "ts":"2026-03-01T00:00:00.000Z"},
  "event_count": 47,
  "event_types": ["expense", "fee", "income"],
  "sources": ["bank", "stripe"],
  "currencies": ["USD"]
}
</metadata>
<summary>
{
  "counts": {"events":47,"non_meta_events":47,"review_items":2},
  "movement_summary": {"operating_inflows":1700,"operating_outflows":55,"operating_net":1645,"tax_outflows":0,"documents_issued":0,"documents_received":0},
  "settlement_summary": {"tracked_documents":12,"open":3,"partial":2,"settled":7,"overpaid":0},
  "receivable_candidates": {"count":2,"open_total":1800},
  "review_materiality": {"by_confidence":{"unclear":{"count":1,"magnitude":75}}},
  "correction_summary": {"correction_events":1,"confirm_events":2}
}
</summary>
</context>
```

Use `clawbooks context 2026-03 --verbose` when you need the full internal summary and raw event payloads. The default compact view is intended to be high-signal rather than exhaustive.

## Policy checks and document views

Use `clawbooks policy lint` for advisory feedback on whether the current policy includes the minimum structured hints and narrative sections the agent will rely on.

Use `clawbooks documents` for neutral settlement views:
- open documents
- aging buckets
- matched vs unmatched by `invoice_id`
- partial and overpaid status
- receivable/payable candidates

These are data views only. The CLI does not decide recognition or accounting basis treatment.

## Recommended conventions

Clawbooks works best when policy and ingestion agree on a few standard fields:

- Lot tracking: `data.lot_id`, `data.lot_ref`, `data.disposition_lots`
- FX / valuation: `data.fx_rate`, `data.base_currency`, `data.price_usd`, `data.price_source`, `data.valuation_ts`
- Provenance: `data.ref`, `data.source_doc`, `data.source_row`, `data.source_hash`, `data.provenance`
- Writer identity: `data.recorded_by`, `data.recorded_via`, `data.import_session`

For append-only review and amendment workflows:
- `reclassify` updates category/type interpretation
- `correction` records field-level fixes against an earlier event
- `confirm` records that an event was reviewed and accepted

These are conventions and audit records, not accounting logic.

## Importing data

There is no import command. The agent is the importer.

```text
You: [paste CSV] "Import this bank statement"

Agent: reads the CSV
       sorts it into chronological order if needed
       reads policy via `clawbooks policy`
       captures opening/closing balances and expected totals
       classifies each row per the policy
       outputs JSONL and pipes it to `clawbooks batch`
       runs `clawbooks reconcile` and `clawbooks verify`

Agent: "Recorded 47 events from Chase March statement."
```

## Asset tracking

Mark purchases for capitalization with `data.capitalize: true`:

```bash
clawbooks record '{"source":"bank","type":"expense","data":{"amount":15000,"currency":"USD","description":"MacBook Pro","category":"hardware","capitalize":true,"useful_life_months":36}}'
```

Then track depreciation, disposals, write-offs, and impairments:

```bash
clawbooks assets --as-of 2026-03-31
clawbooks record '{"source":"manual","type":"disposal","data":{"asset_id":"<id>","proceeds":5000,"currency":"USD"}}'
```

## Scaling

When the ledger grows large, compact old periods into an archive:

```bash
clawbooks compact 2025-12
# -> archives old events to ledger-archive-2025-12-31.jsonl
# -> rewrites the main ledger as: 1 snapshot + newer events
```

The archive remains a complete hash-chained ledger for audits. The main ledger stays small enough for agent context windows.

## Audit packs

Generate a folder of standard-format files for accountants or auditors:

```bash
clawbooks pack 2026-01/2026-12-31 --out ./annual-pack
```

This produces `general_ledger.csv`, `summary.json`, `verify.json`, and a copy of `policy.md`, plus additional files when relevant:
- `asset_register.csv`
- `reclassifications.csv`
- `corrections.csv`
- `confirmations.csv`

The output is assistive. It gives an accountant structured working material, not a pretend finished report.

## Agent setup

Point your agent at `program.md` for instructions on how to use clawbooks.

For first-run or global-install workflows, start with:

```bash
clawbooks doctor
```

This prints:
- resolved books / ledger / policy paths
- whether books are initialized yet
- packaged support files such as `program.md` and `agent-bootstrap.md`
- policy readiness signals such as `missing`, `starter`, or `customized`
- recommended next commands for the agent
- a reusable bootstrap prompt

If `doctor` reports the policy as `starter`, the agent should still be able to proceed, but it should explicitly say that the resulting financials are provisional and point out the main assumptions or classifications that need refinement.

- **Claude Code**: add `Read program.md in the clawbooks directory for financial record-keeping instructions.`
- **Any coding agent**: add the same pointer in `AGENTS.md`, your harness instructions, or use the packaged `agent-bootstrap.md`
- **Any shell-capable agent**: clawbooks prints structured text for the agent to read and reason over

The npm package includes `program.md`, `agent-bootstrap.md`, and the policy examples, so this workflow also works from a global install.

Example bootstrap prompt:

```text
Use clawbooks in this folder. Run `clawbooks doctor`, read `program.md` and `policy.md`, inspect the source files, import normalized events with provenance fields, then run `clawbooks verify`, `clawbooks summary`, and `clawbooks context` for the requested period before answering.
```

## Packaging

The primary package should stay `clawbooks` for the clean install path.
If you later want a brand-owned scoped companion package, the repo can stage `@clawbooks/cli` without renaming the live package:

```bash
npm run scoped:prepare
npm run scoped:pack:dry-run
```

This writes a temporary scoped package into `.dist/scoped-cli` for inspection or future publish work.

## Files

```text
cli.ts                  CLI commands
ledger.ts               JSONL read/write/filter
program.md              Agent instructions
agent-bootstrap.md      Reusable agent bootstrap prompt
.books/
  policy.md             Your accounting rules (seeded, then edited)
  ledger.jsonl          Your financial events (append-only)
  ledger-archive-*.jsonl
  audit-pack-*/
policy.md.example       Starter policy template bundled with the package
policy-simple.md.example
policy-complex.md.example
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBOOKS_BOOKS` | auto-detected `.books/` | Books directory |
| `CLAWBOOKS_LEDGER` | unset | Direct ledger path override |
| `CLAWBOOKS_POLICY` | unset | Direct policy path override |

No API key needed. Bring your own agent.

## License

MIT
