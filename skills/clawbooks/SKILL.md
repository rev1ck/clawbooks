---
name: "clawbooks"
description: "Use when a task involves Clawbooks books, `program.md`, `policy.md`, `ledger.jsonl`, importing financial data, reconciling balances, reviewing classifications, producing reports, or integrating `clawbooks/operations` from shell agents, OpenClaw, or app and web adapters."
---

# Clawbooks

Use this skill for general Clawbooks work across CLI sessions, OpenClaw-style hosts, and app or web adapters. Prefer the local books, policy, and event schema over bundled examples. The project in front of you is the source of truth.

## Quick Start

If you have CLI access:

1. Run `clawbooks quickstart`.
2. Read the resolved `program.md`.
3. Read the resolved `policy.md`.
4. Read `docs/event-schema.md` before introducing or changing event shapes.
5. Run `clawbooks workflow ack --program --policy` after reading the operating files for the current run.

If you do not have CLI access:

1. Load the equivalent project files: `program.md`, `policy.md`, and `docs/event-schema.md`.
2. Treat outputs as provisional until the current run has clearly read those files.
3. Use `clawbooks/operations` as the behavior source of truth.

If no books exist yet, initialize them with `clawbooks init` when the host allows it.

## Surface Selection

Use the CLI when you have shell access and need operator workflows such as:

- bootstrapping books
- importing staged files
- running verify, reconcile, review, or pack
- inspecting on-disk books

Use `clawbooks/operations` when you are inside an app, service, worker, OpenClaw adapter, or Agent SDK-backed UI and need Clawbooks behavior without shelling out.

Adapter rule:

- operations take data in and return data out
- operations may throw instead of exiting the process
- the adapter owns filesystem, UI, network, and user interaction
- writes still go through prepared Clawbooks write paths, never direct `ledger.jsonl` mutation

Load `references/surfaces.md` only when you need concrete CLI sequences or embedded usage patterns.

## Core Workflow

1. Resolve which books directory, ledger, and policy are in scope.
2. Read the raw financial source material first.
3. Normalize source material into canonical Clawbooks events.
4. Preserve provenance on imports: `source_doc`, `source_row`, `source_hash`, and stable source IDs such as `ref`.
5. Write through `clawbooks record`, `clawbooks batch`, `prepareRecord`, or `prepareBatch`.
6. Run validation, verification, and reconciliation where the source supports it.
7. Review inferred or unclear classifications before presenting final outputs.
8. Answer from the ledger plus policy, not from ad hoc spreadsheet logic or memory.

## Decision Rules

- Start with `summary` for aggregate questions; use `context` only when event-level reasoning is actually needed.
- Use `documents` for receivables, payables, settlement, and aging.
- Use `assets` for capitalized assets and depreciation.
- Use `review` for material uncertainty.
- Use `verify` and `reconcile` for integrity and source-total checks.
- Do not hardcode a source filter unless the user asked for one.
- Read `policy.md` before classifying; policy controls recognition and categorization.
- Read `docs/event-schema.md` before extending the event shape.

## Accounting Behavior Rules

- The ledger stores facts.
- The policy states the accounting rules.
- The agent does the reasoning.

Known flow types use sign conventions enforced by Clawbooks. Document types such as `invoice` and `bill` use `data.direction`. Append-only audit events such as `confirm`, `reclassify`, `correction`, and `snapshot` adjust interpretation without rewriting history.

Do not hand-edit `id` or `prev`.

## Uncertainty Rules

Clawbooks supports provisional work. That does not permit false certainty.

When policy is generic, incomplete, or unread for the current run:

- say the output is provisional
- state the material assumptions
- use `confidence` honestly
- surface unresolved classification or reconciliation risks

Use:

- `clear` when the evidence and policy support the classification cleanly
- `inferred` when the classification is reasonable but not certain
- `unclear` when you cannot support a reliable classification

## Never Do These Things

- Never edit `ledger.jsonl` directly.
- Never silently drop rows to force a clean reconciliation.
- Never treat vendor mappings as a replacement for `policy.md`.
- Never present provisional output as policy-grounded final accounting.
- Never introduce new event shapes without checking `docs/event-schema.md`.
- Never answer accounting questions from raw events alone when `policy.md` changes recognition or categorization.

## Success Criteria

The skill has been applied correctly when:

- the current books and policy are clearly identified
- source material has been normalized into canonical events with provenance
- writes happen through Clawbooks write paths or prepared operations
- integrity and review surfaces have been used where appropriate
- final answers distinguish policy-grounded conclusions from provisional ones
