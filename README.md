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

Clawbooks also tracks whether a run is:

- `policy_grounded`: the current run has acknowledged `program.md` and `policy.md`
- `provisional`: the run is exploratory or heuristic and should not be presented as final accounting

No rules engine. No SDK. No framework.

## What Clawbooks Is

Clawbooks is for the workflow where an agent reads raw financial material, normalizes it into durable ledger events, validates the result, and then produces reporting outputs from the same record.

Bring:

- bank CSVs
- card exports
- Stripe exports
- exchange fills
- invoices and bills
- receipts
- copied transaction text

Clawbooks does not try to parse PDFs for you. The intended boundary is: the agent extracts structured rows upstream, then Clawbooks stores and checks the resulting facts.

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
- explicit single-currency converted views where imports store `data.base_amount`
- custom period reporting and transaction investigations

The outputs come from combining `summary`, `context`, `documents`, `assets`, `verify`, `reconcile`, and `pack` with the rules in `policy.md`.
The same pure business logic is also exported as `clawbooks/operations` for non-CLI adapters.

Those outputs should be read together with the run state:

- use `clawbooks workflow ack --program --policy` once the agent has read the operating files for the current run
- expect `policy_grounded` outputs after that acknowledgment
- treat `provisional` outputs as exploratory and assumption-heavy

## The Operating Model

```text
Raw sources
CSV / statement / receipt / export / copied text
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

## CLI And Operations Module

The CLI is the default operator surface, but the package also exports a shared operations layer:

```ts
import {
  buildSummary,
  buildImportCheck,
  buildReviewQueue,
  prepareRecord,
  prepareBatch,
} from "clawbooks/operations";
```

Use `clawbooks/operations` when you want the same business logic in another adapter such as a web app, background worker, or tests.

- operations take data in and return data out
- operations throw on invalid input instead of calling `process.exit`
- write helpers return prepared events or JSONL lines while the adapter performs actual I/O

The CLI uses that same layer internally, so reporting and validation behavior stays aligned across surfaces.

## Codex Skill

Clawbooks also ships an installable Codex skill in [`skills/clawbooks`](./skills/clawbooks/).

Where skills live:

- distributed from a repo under a folder such as `skills/clawbooks/`
- installed locally into `~/.codex/skills/clawbooks` or `$CODEX_HOME/skills/clawbooks`

If you installed `clawbooks` from npm, the easiest path is:

```bash
clawbooks skill install
```

That copies the packaged skill into your local Codex skills directory. Then restart Codex.

Useful variants:

```bash
clawbooks skill path
clawbooks skill install --force
clawbooks skill install --dest ~/.codex/skills
```

If you want to install the skill directly from this repo instead of from the npm package, use your Codex skill installer against the repo path `skills/clawbooks`, or copy that folder into your local Codex skills directory under the name `clawbooks`.

The repo and npm package should be the canonical distribution surfaces for the skill. A website can help users discover the skill and explain what it does, but the website should link back to the repo or package install path rather than becoming the source of truth for the skill contents.

## First Run

Install:

```bash
npm install -g clawbooks@latest
clawbooks version
clawbooks --help
```

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
4. Run `clawbooks workflow ack --program --policy`
5. Import normalized events with `clawbooks record` or `clawbooks batch`
6. Run `clawbooks verify` and `clawbooks reconcile`
7. Use reporting commands to produce the required financial view

If you skip the acknowledgment step, reporting remains provisional by design.

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
clawbooks workflow status
clawbooks workflow ack --program --policy
clawbooks workflow ack --program --policy --classification-basis policy_explicit
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
clawbooks import scaffold --list
clawbooks import scaffold statement-csv
clawbooks import scaffold generic-csv
clawbooks import scaffold fills-csv
clawbooks import scaffold manual-batch
clawbooks import scaffold opening-balances
clawbooks import run statement.csv --statement statement-profile.json
# edit mapper.mjs or mapper.py, then run it to emit JSONL
clawbooks import check staged.jsonl --statement statement-profile.json --save-session
clawbooks import check staged.jsonl --statement statement-profile.json --classification-basis heuristic_pattern
clawbooks import sessions list
clawbooks import mappings suggest --source statement_import
clawbooks import mappings lookup "NETFLIX"
clawbooks import mappings check staged.jsonl --mappings .books/imports/statement-csv/vendor-mappings.json
clawbooks import reconcile staged.jsonl --statement statement-profile.json
clawbooks record '{"source":"bank","type":"income","data":{"amount":500,"currency":"USD"}}'
clawbooks record '{"source":"manual","type":"expense","data":{"amount":25,"currency":"USD"}}' --classification-basis manual_operator
cat events.jsonl | clawbooks batch --classification-basis manual_operator
```

`import check --save-session` writes an operator sidecar record of the validation run. In a normal books workspace this lives under `.books/imports/sessions/`.
`import sessions list` and `import sessions show <id|latest>` make those sidecars usable as a first-class operator surface.
Those import sessions also preserve run-level grounding such as `classification_basis`, `program_hash`, `policy_hash`, and whether workflow acknowledgment was current at the time of validation.
`import reconcile` produces a dedicated statement reconciliation artifact comparing staged rows, imported ledger rows, and declared statement expectations.
`import check` also reports the resolved mappings discovery path order. If you do not pass `--mappings`, clawbooks checks the scaffold location and `.books/vendor-mappings.json`.
`import run` is the fast path for predictable statement CSVs with stable column names. It stages JSONL, can run `import check` automatically when you pass `--statement`, and can append directly with `--append`.
`import scaffold opening-balances` is the fast path for seeding many opening balances from a simple table instead of hand-writing one `opening_balance` event at a time.
`import mappings lookup "<description>"` is the quick reference surface for seeing how a name would match the current mappings file and whether the ledger already has a stable historical classification for it.
When practical, ingest full source coverage first and use periods/ranges later for reporting and checking.

Inspect:

```bash
clawbooks log --last 10
clawbooks stats
clawbooks policy
clawbooks policy lint
clawbooks documents 2026-03
clawbooks documents FY2025 --direction received --status open --group-by counterparty
clawbooks documents counterparties FY2025 --format csv
```

`policy lint` is heuristic and advisory. It reports severity-tagged checks, starter-vs-custom readiness signals, workflow-aware guidance for statements, documents, review/materiality, and trading-heavy policies, and validates `reporting.financial_year_end` for fiscal-year shorthand.

If you are starting from scratch, the fastest path is usually:

```bash
clawbooks init
clawbooks quickstart
clawbooks import scaffold statement-csv
clawbooks import run statement.csv --statement statement-profile.json
clawbooks import check statement.staged.jsonl --statement statement-profile.json --save-session
```

For a full statement-shaped walkthrough, see [docs/statement-import-example.md](./docs/statement-import-example.md).

`vendor-mappings.json` is optional and factual. It is a reusable hint file for recurring source descriptions. It does not replace or override `policy.md`.
For statement-style scaffold workflows, keep it near the scaffold. For broader book-level reuse, `.books/vendor-mappings.json` is also discovered.

Analyze and report:

```bash
clawbooks summary 2026-03
clawbooks summary FY2025
clawbooks summary 2026-03 --base-currency USD
clawbooks context 2026-03
clawbooks context 2026-03 --base-currency USD
clawbooks context 2026-03 --include-policy
clawbooks verify 2026-03 --balance 50000 --opening-balance 45000 --currency USD
clawbooks verify 2026-03 --balance 50000 --opening-balance 45000 --currency USD --diagnose
clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --opening-balance 45000 --closing-balance 46250 --date-basis posting --gaps
clawbooks review 2026-03 --source bank --confidence inferred,unclear --min-magnitude 100 --group-by category
clawbooks review batch 2026-03 --out review-actions.jsonl --action confirm --confidence inferred
clawbooks review batch 2026-03 --out reclassify.jsonl --action reclassify --confidence unclear --new-category software
clawbooks assets --as-of 2026-03-31
clawbooks pack 2026-03 --out ./march-pack
clawbooks pack 2026-03 --out ./march-pack --base-currency USD
clawbooks pack 2026-03 --out ./march-pack --allow-provisional
```

`review` surfaces a materiality-first queue and explains why each item is in review. `review batch` writes append-only JSONL action files for inspection before you apply them with `clawbooks batch`.
`summary`, `review`, `verify`, and `reconcile` now echo their resolved scope so operators can see the actual time window and filters that were applied.
`documents` now supports debtor/creditor-style grouping and export without adding accounting rules: use `--direction`, `--status`, `--counterparty`, `--group-by counterparty`, or `documents counterparties`.
`verify --diagnose` adds likely-cause hints for balance mismatches such as running-balance disagreement, duplicate-like rows, or currency-mixing.
When you pass `--base-currency`, `summary`, `context`, and `pack` only use explicit `data.base_amount` + `data.base_currency` facts for converted totals. They do not derive converted totals from `data.fx_rate` or `data.price_usd`.
`summary`, `context`, and `review` can be run in provisional mode when you explicitly choose exploratory output. `pack` is stricter: it refuses provisional runs unless you pass `--allow-provisional`.
`pack --base-currency` is stricter again: it refuses partial FX coverage unless you also pass `--allow-partial-fx`.
For non-CLI integrations, the same logic is available from `clawbooks/operations`.
Period arguments support whole years (`2026`), months (`2026-03`), fiscal-year shorthand (`FY2025`), and explicit ranges (`2026-01/2026-06-30`).

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
node -e "import('./build/operations.js').then(m => console.log(Object.keys(m).sort()))"
```

## Boundary

Clawbooks does not contain an accounting engine.

You and your agent still decide:

- how to interpret edge cases
- how to write and refine policy
- how to classify messy source material
- which outputs to present

Clawbooks provides the durable record, validation surface, reporting primitives, and packaging layer that make that workflow repeatable.
