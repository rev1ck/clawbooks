<p align="center">
  <img src="./logo.png" alt="clawbooks logo" width="180" align="center">
</p>

<h1 align="center">clawbooks</h1>

<p align="center"><strong>Financial memory for agents.</strong></p>

<p align="center">Append-only ledger • Plain-English policy • Agent-native accounting CLI</p>

Clawbooks is an append-only ledger, a plain-English accounting policy, and a CLI.
Your agent reads the data, reads the policy, and does the accounting.

No rules engine. No SDK. No framework.

**Two source files. Zero runtime dependencies.**

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
Agent reads:   policy + snapshot + events
Agent reasons: applies the policy to the records
Agent replies: "Revenue: $1,700. Expenses: $475. Net: $1,225."
```

There is no accounting engine. In clawbooks, the agent is the engine.

## Install

```bash
npm install -g clawbooks
clawbooks --help
cp policy.md.example policy.md
```

## Local setup

```bash
git clone https://github.com/rev1ck/clawbooks.git
cd clawbooks
npm install
npm run build
cp policy.md.example policy.md   # edit with your own accounting rules
```

## How it works

Clawbooks stores financial events and outputs accounting context.
The important command is `clawbooks context`: it prints a structured context envelope with metadata, instructions, policy, summary, snapshot, and raw events so an agent can reason from both overview and detail.

## Commands

```bash
# Write events
clawbooks record '{"source":"stripe","type":"payment","data":{"amount":500,"currency":"USD"}}'
cat events.jsonl | clawbooks batch

# Read events
clawbooks log --last 10
clawbooks log --source stripe --after 2026-03-01
clawbooks stats

# Load context for the agent
clawbooks context 2026-03
clawbooks context --after 2026-01-01

# Analysis
clawbooks verify 2026-03                            # integrity + chain + duplicates
clawbooks verify --balance 50000 --currency USD     # cross-check closing balance
clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --gaps
clawbooks review --source bank                      # items needing classification
clawbooks summary 2026-03                           # aggregates for reports
clawbooks snapshot 2026-03 --save                   # persist period snapshot
clawbooks assets --as-of 2026-03-31                 # asset register + depreciation

# Maintenance
clawbooks compact 2025-12                           # archive old events, shrink ledger
clawbooks pack 2026-03 --out ./march-pack           # generate audit pack (CSVs + JSON)

# Print the policy
clawbooks policy
```

## The context command

This is the core command. It prints a `context` envelope for the requested period:

- `metadata` explains the requested and effective window, whether a snapshot was used, and what kinds of records are present
- `instructions` tells the agent how to interpret snapshot plus events
- `policy` is your plain-English accounting policy
- `summary` provides orientation before the raw records
- `snapshot` is the starting state, when available
- `events` contains the raw append-only records the agent should reason from

```bash
$ clawbooks context 2026-03

<context schema="clawbooks.context.v2">
<metadata>
{
  "requested_window": {"after":"2026-03-01T00:00:00.000Z","before":"2026-03-31T23:59:59.999Z"},
  "effective_window": {"after":"2026-03-01T00:00:00.000Z","before":"2026-03-31T23:59:59.999Z"},
  "snapshot": {"used": true, "ts":"2026-03-01T00:00:00.000Z"},
  "event_count": 47,
  "sources": ["bank", "stripe"],
  "currencies": ["USD"]
}
</metadata>

<instructions>
Read the policy first.
Treat the snapshot as the starting state.
Apply the events block on top of that snapshot.
</instructions>

<policy>
# Accounting policy
Cash basis. Crypto trades are revenue income...
</policy>

<summary>
{
  "by_type": {"income":{"count":12,"total":1700},"fee":{"count":3,"total":-55}},
  "by_currency": {"USD":{"count":15,"total":1645}},
  "cash_flow": {"inflows":1700,"outflows":-55,"net":1645}
}
</summary>

<snapshot as_of="2026-03-01T00:00:00.000Z">
{"balances":{"USD":45000},"ytd_pnl":18450}
</snapshot>

<events count="47" after="2026-03-01T00:00:00.000Z" before="2026-03-31T23:59:59.999Z">
{"ts":"...","source":"stripe","type":"payment","data":{"amount":500,...}}
{"ts":"...","source":"bank","type":"fee","data":{"amount":-55,...}}
...
</events>
</context>
```

## Importing data

There is no import command. The agent is the importer.

```text
You: [paste CSV] "Import this bank statement"

Agent: reads the CSV
       reads policy via `clawbooks policy`
       classifies each row per the policy
       outputs JSONL and pipes it to `clawbooks batch`

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

This produces `general_ledger.csv`, `summary.json`, `asset_register.csv`, `reclassifications.csv`, `verify.json`, and a copy of `policy.md`.
The output is assistive. It gives an accountant structured working material, not a pretend finished report.

## Agent setup

Point your agent at `program.md` for instructions on how to use clawbooks.

- **Claude Code**: add `Read program.md in the clawbooks directory for financial record-keeping instructions.`
- **Codex**: add the same pointer in `AGENTS.md` or your system prompt
- **Any shell-capable agent**: clawbooks prints structured text for the agent to read and reason over

The npm package includes `program.md` and the policy examples, so this workflow also works from a global install.

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
policy.md               Your accounting rules (you write this, gitignored)
policy.md.example       Example policy to start from
ledger.jsonl            Your financial events (append-only, gitignored)
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBOOKS_LEDGER` | `./ledger.jsonl` | Path to ledger |
| `CLAWBOOKS_POLICY` | `./policy.md` | Path to policy |

No API key needed. Bring your own agent.

## License

MIT
