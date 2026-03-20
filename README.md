<p align="center">
  <img src="./logo.png" alt="clawbooks logo" width="180" align="center">
</p>

<h1 align="center">clawbooks</h1>

<p align="center"><strong>Financial memory for agents.</strong></p>

<p align="center">Append-only ledger • Plain-English policy • Agent-native accounting CLI</p>

Clawbooks is an accounting system built for agents.

It gives the agent three things:

- `program.md`: the operating manual
- `policy.md`: the accounting policy for the current books
- `ledger.jsonl`: the append-only financial record

And one core reference:

- `docs/event-schema.md`: the canonical event envelope and schema evolution guide

The ledger stores facts. The policy states the accounting rules. The agent does the reasoning.

No rules engine. No SDK. No framework.

## What Clawbooks Is

Clawbooks is for the workflow where an agent reads raw financial material, normalizes it into durable ledger events, validates the result, and then produces reporting outputs from the same record.

Bring:

- bank CSVs
- card exports
- Stripe exports
- exchange fills
- invoices and bills
- receipts and PDFs
- copied transaction text

The agent reads the source, applies `policy.md`, writes normalized events into clawbooks, and then uses the CLI to produce financial outputs and audit evidence.

## Why It Exists

Most accounting software embeds bookkeeping logic in the product.

Clawbooks takes the opposite position:

- the ledger stores financial facts
- the policy describes interpretation in plain English
- the agent performs the accounting work

That makes clawbooks useful anywhere an agent can read files and run shell commands.

## What You Can Produce

Clawbooks is not just for lightweight summaries. The toolchain is intended to support:

- P&L
- balance sheet
- cash flow
- receivables and payables views
- settlement and aging views
- tax-oriented cuts
- asset register and depreciation
- reconciliations and integrity checks
- audit packs
- custom period reporting and transaction investigations

The outputs come from combining `summary`, `context`, `documents`, `assets`, `verify`, `reconcile`, and `pack` with the rules in `policy.md`.

## The Operating Model

```text
Raw sources
CSV / statement / receipt / PDF / export / copied text
  ->
Agent reads program.md + policy.md
  ->
Agent normalizes source material into clawbooks events
  ->
ledger.jsonl stores append-only financial facts
  ->
verify / reconcile / review / snapshot
  ->
summary / context / documents / assets / pack
  ->
P&L / balance sheet / cash flow / tax views / audit outputs
```

## First Run

Install:

```bash
npm install -g clawbooks
clawbooks --help
```

Current version target: `0.2.0`

Bootstrap:

```bash
clawbooks quickstart
```

`quickstart` explains the system in the current folder, shows which `program.md`, `policy.md`, and `ledger.jsonl` are in scope, and outlines the reporting surface available from the CLI.

If no books exist yet:

```bash
clawbooks init
```

This creates a `.books/` directory with:

- `ledger.jsonl`
- `policy.md`
- `program.md`

Then:

1. Read `program.md`
2. Read `.books/policy.md`
3. Tailor the policy to the entity, jurisdiction, basis, and review rules
4. Import normalized events with `clawbooks record` or `clawbooks batch`
5. Run `clawbooks verify` and `clawbooks reconcile`
6. Use reporting commands to produce the required financial view

## The Core Files

### `program.md`

This is the agent operating manual.

It explains:

- how to use clawbooks
- how to import events
- how to think about reports
- what conventions to preserve

### `policy.md`

This is the accounting policy for the current books.

It should define:

- entity details
- reporting basis
- recognition rules
- categorization and review rules
- document handling
- reconciliation expectations
- any jurisdiction-specific tax or accounting conventions

### `ledger.jsonl`

This is the append-only ledger.

Each line is a canonical event envelope with:

- timestamp
- source
- type
- data payload
- deterministic id
- previous-line hash pointer

See [docs/event-schema.md](./docs/event-schema.md) for the schema and field conventions.

## Commands By Job

Bootstrap and setup:

```bash
clawbooks quickstart
clawbooks doctor
clawbooks where
clawbooks init
clawbooks init --list-examples
clawbooks init --example simple
clawbooks init --example complex
clawbooks policy --list-examples
clawbooks policy --example simple
```

Import:

```bash
clawbooks import scaffold statement-csv
clawbooks import scaffold generic-csv
# edit mapper.mjs or mapper.py, then run it to emit JSONL
clawbooks import check staged.jsonl --statement statement-profile.json
clawbooks record '{"source":"bank","type":"income","data":{"amount":500,"currency":"USD"}}'
cat events.jsonl | clawbooks batch
```

Inspect:

```bash
clawbooks log --last 10
clawbooks stats
clawbooks policy
clawbooks policy lint
clawbooks documents 2026-03
```

`policy lint` is heuristic and advisory. It reports severity-tagged checks, starter-vs-custom readiness signals, and workflow-aware guidance for statements, documents, review/materiality, and trading-heavy policies.

If you are starting from scratch, the fastest path is usually:

```bash
clawbooks init
clawbooks quickstart
clawbooks import scaffold statement-csv
clawbooks import check staged.jsonl --statement statement-profile.json
```

Analyze and report:

```bash
clawbooks summary 2026-03
clawbooks context 2026-03
clawbooks context 2026-03 --include-policy
clawbooks verify 2026-03 --balance 50000 --opening-balance 45000 --currency USD
clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --opening-balance 45000 --closing-balance 46250 --date-basis posting --gaps
clawbooks review 2026-03 --source bank --confidence inferred,unclear --min-magnitude 100 --group-by category
clawbooks review batch 2026-03 --out review-actions.jsonl --action confirm --confidence inferred
clawbooks review batch 2026-03 --out reclassify.jsonl --action reclassify --confidence unclear --new-category software
clawbooks assets --as-of 2026-03-31
clawbooks pack 2026-03 --out ./march-pack
```

Maintenance:

```bash
clawbooks snapshot 2026-03
clawbooks snapshot 2026-03 --save
clawbooks compact 2025-12
```

## Testing And Release Checks

For local validation:

```bash
npm test
npm run test:e2e
npm run test:release
```

`npm run test:e2e` exercises the end-to-end operator flow twice:

- once against the built local CLI
- once against the packed npm tarball installed into a clean temp directory

That makes it a useful pre-release check for packaging, bundled docs, and the real import/review/report workflow.

## What Snapshot Means

`snapshot` is a saved derived checkpoint inside the ledger.

- `clawbooks snapshot <period>` computes and prints derived state
- `clawbooks snapshot <period> --save` appends a `snapshot` event into the ledger

A snapshot stores derived balances and reporting summaries. It is not the canonical source of truth and it is not a full stored set of books. The source of truth remains the append-only ledger.

## Where Books Live

The default pattern is project-local:

```bash
clawbooks init
```

This creates `.books/` in the current project.

Multi-entity workflows can use named books directories:

```bash
clawbooks init --books .books-company
clawbooks init --books .books-personal
clawbooks --books .books-company summary 2026-03
CLAWBOOKS_BOOKS=.books-personal clawbooks stats
```

Use `clawbooks where` to confirm the resolved books directory, ledger path, and policy path before importing or reporting.

## Event Schema

The canonical event contract is documented in [docs/event-schema.md](./docs/event-schema.md).

That document defines:

- the event envelope
- required fields
- sign conventions
- known event types
- document events
- snapshot events
- review and correction events
- asset lifecycle events
- provenance fields

## Local Development

```bash
git clone https://github.com/rev1ck/clawbooks.git
cd clawbooks
npm install
npm run build
node build/cli.js quickstart
```

## Boundary

Clawbooks does not contain an accounting engine.

You and your agent still decide:

- how to interpret edge cases
- how to write and refine policy
- how to classify messy source material
- which outputs to present

Clawbooks provides the durable record, validation surface, reporting primitives, and packaging layer that make that workflow repeatable.
