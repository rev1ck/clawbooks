# Clawbooks Next Product Stance

## Purpose

This document sharpens the product direction that follows from recent test-run feedback.

The goal is to reduce blank-page friction in the highest-frequency workflows while preserving the core clawbooks philosophy:

- the ledger stores facts
- policy states interpretation
- the agent performs the accounting work

## What We Agree With

### 1. Books workspace coherence should improve

`clawbooks init` currently feels slightly split because `ledger.jsonl` and `policy.md` are book-local while `program.md` lives in the package.

Decision:

- make the books directory the obvious working surface
- seed a book-local `program.md` during `init`
- keep the packaged `program.md` as the canonical bundled source
- avoid overwriting an existing book-local `program.md`

This reduces surprise without changing the underlying operating model.

### 2. Importing needs first-class scaffolding

Import friction is real, especially for statements and CSV exports.

Decision:

- add scaffold commands that generate mapper templates and checklists
- do not add institution-specific importers
- do not guess semantics and present them as certainty

The scaffold should help the user or agent produce canonical events, preserve provenance, and validate completeness.

### 3. Statement reconciliation needs stronger primitives

Statement workflows often need more than row counts and debit/credit totals.

Decision:

- improve reconciliation ergonomics for statement-style imports
- explicitly support opening balance and closing balance checks
- explicitly support date basis selection where transaction date and posting date differ

This should help users separate economic cutoffs from statement-boundary checks.

### 4. Policy needs stronger rails, not provider-specific abstractions

The issue is not a specific provider such as VALR. The issue is that users need better generic ways to express:

- canonical ledger fact
- reporting interpretation
- review and reconciliation conventions

Decision:

- improve the existing policy linter
- add guidance for reporting-view and statement semantics where the policy text signals that they matter
- avoid provider-specific policy constructs
- avoid making default policy files more complex than necessary

### 5. Review should become more action-oriented

The current review surface is useful but still thin for operational workflows.

Decision:

- keep review as a decision-support loop
- expose clearer confidence filtering and materiality controls
- avoid opaque auto-fixing behavior

## What We Reject

- institution-specific importers as a core product direction
- hidden inference that silently guesses accounting semantics
- provider-specific policy modes
- one scaffold pretending to fit every import shape
- a heavyweight reporting DSL before repeated policy patterns justify it

## Scope For This Implementation Pass

### Included

- book-local `program.md` seeded by `init`
- `import scaffold` command family
- improved policy linting
- reconciliation improvements for statement-style checks
- review filtering for confidence and materiality

### Deferred

- a large library of policy examples
- institution-specific example packs
- bulk correction helpers
- a new reporting DSL
- automatic import validation beyond scaffold guidance

## CLI Direction

### Init

`clawbooks init`

Creates:

- `ledger.jsonl`
- `policy.md`
- `program.md`

within the chosen books directory.

### Import Scaffolds

`clawbooks import scaffold <kind>`

Supported scaffold kinds:

- `statement-csv`
- `generic-csv`
- `fills-csv`
- `manual-batch`

Design rules:

- scaffold by source shape, not by institution
- emit editable templates, not executable certainty
- include provenance and normalization guidance
- make statement semantics explicit where relevant

### Reconcile

Improve `clawbooks reconcile` so it can express statement-style checks:

- `--opening-balance`
- `--closing-balance`
- `--date-basis ledger|transaction|posting`

### Review

Improve `clawbooks review` so the operator can work the queue more directly:

- `--confidence`
- `--min-magnitude`
- `--limit`

## Notes On Policy

Policy remains the authority for interpretation.

The CLI may expose more operational switches, but those switches should not replace policy. They should help the operator inspect, reconcile, and review data using explicit assumptions.

The default policy must remain short enough to edit comfortably. Stronger rails should come from:

- linting
- scaffold guidance
- curated examples over time

not from making the starter policy bloated.

