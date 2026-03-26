---
name: "clawbooks"
description: "Use when a task involves Clawbooks books, `program.md`, `policy.md`, `ledger.jsonl`, importing financial data, reconciling balances, reviewing classifications, producing reports, or integrating `clawbooks/operations` from shell agents, OpenClaw, or app and web adapters."
---

# Clawbooks

## Quick Start

If you have CLI access:

1. Run `clawbooks quickstart`
2. Read `program.md` and `policy.md`
3. Run `clawbooks workflow ack --program --policy`

If you do not have CLI access, load `program.md`, `policy.md`, and `docs/event-schema.md` from the project. Treat outputs as provisional until these files have been read.

## Surface Selection

Use the **CLI** when the host can run shell commands: bootstrapping, importing, verify/reconcile/review, reporting, audit packs.

Use **`clawbooks/operations`** when called from app code, a worker, an OpenClaw adapter, or an Agent SDK-backed UI:

- Operations take data in and return data out
- Operations may throw instead of exiting the process
- The adapter owns filesystem, UI, network, and user interaction
- Writes go through prepared Clawbooks write paths, never direct `ledger.jsonl` mutation

Load `references/surfaces.md` only when you need concrete CLI sequences or embedded usage patterns.

## Guardrails

See `program.md` for the full list. The critical ones:

- Never edit `ledger.jsonl` directly
- Never present provisional output as policy-grounded final accounting
- Never answer accounting questions without reading `policy.md`
