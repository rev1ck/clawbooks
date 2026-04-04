# Clawbooks

The ledger stores facts and durable accounting treatments. The policy states the rules. The agent does the accounting.

- `program.md` — how to operate clawbooks (this file)
- `policy.md` — how the current entity should be accounted for
- `event-schema.md` — how facts and treatments are encoded in the ledger
- `--help` — CLI command and flag reference

The CLI is data storage. You are the accountant.

Treat this as a three-layer system:

- `policy.md` stores entity-level accounting rules
- fact events store what happened
- `treatment` events store durable case-level accounting judgment

## Grounding sequence

Every session that touches real data must start grounded:

1. `clawbooks quickstart` — confirms which books, ledger, and policy are in scope
2. Read `program.md` (this file)
3. Read `policy.md` for the current books
4. Read `event-schema.md` before introducing or changing event shapes
5. `clawbooks workflow ack --program --policy` after reading the operating files

If no books exist, run `clawbooks init` first.
If you skip the grounding sequence, your output is provisional — say so.

## Answering questions vs doing work

Not every financial question requires an import. When the user asks something like "what did we spend on hosting last quarter?" — that is a read-only task:

1. Run `clawbooks summary` or `clawbooks context` for the relevant period
2. Apply `policy.md` to interpret the data
3. Answer from the ledger

Only start the import workflow when the user provides new source material to process. Do not treat a financial question as an invitation to re-import or restructure existing data.

## Guardrails

- Never edit `ledger.jsonl` directly — use `record`, `batch`, or prepared operations
- Never silently drop rows to force a clean reconciliation
- Never treat vendor mappings as a replacement for `policy.md`
- Never present provisional output as policy-grounded final accounting
- Never introduce new event shapes without checking `event-schema.md`
- Never answer accounting questions from raw events alone when `policy.md` changes recognition or categorization

## Common mistakes

- Bank credits are not automatically income
- Transfers are not automatically revenue
- Exchange withdrawals may be treasury movement, not P&L activity
- Owner-funded or owner-paid transactions may be equity movements, not operating expense
- Hardware may belong in capex rather than operating expense
- Tax payments may require separate treatment from operating expenses

## What belongs in the ledger

Users may point you at folders of mixed documents — contracts, emails, receipts, statements, spreadsheets, PDFs. Not everything is a ledger event. Before importing, reason through what is relevant.

A source row becomes a ledger event when it records a financial fact: money moved, an obligation was created, an asset changed, or the books need an adjustment. Specifically:

- **Record it** if it represents a cash movement into or out of a controlled account, a recognized revenue or expense event, an asset acquisition or disposal, a liability created or settled, an equity movement, or a tax payment
- **Record it as a document** (`invoice`/`bill`) if it creates a receivable or payable, even if no cash has moved yet
- **Skip it** if it is a duplicate of something already in the ledger, an internal memo with no financial effect, a draft or unsigned document, marketing material, or a file that describes the business but does not record a transaction
- **Ask** if it is ambiguous — a contract that might create a future obligation, a receipt that might be personal, or a document you cannot confidently classify

Use `policy.md` to resolve entity-specific questions: which accounts are controlled, which activity is in scope, what the capitalization threshold is, and how to handle the boundary between personal and business. If the policy does not cover a source type, flag it rather than guessing.

The goal is a complete and accurate ledger, not a ledger that contains everything the user handed you.

## Durable treatments

If the accounting judgment is durable, material, and likely to matter again, persist it as a `treatment` event in `ledger.jsonl`.

Use treatments for positions like:

- capitalization of a specific purchase
- accrual timing for a specific bill or contract
- owner-boundary decisions tied to a specific event or counterparty
- durable classification overrides

Do not put these case-by-case decisions into `policy.md` when there are many of them. `policy.md` should hold the rule; `treatment` should hold the applied accounting thesis for the specific case.

## Importing source data

When the user gives you a CSV, statement, or other raw financial data:

1. Establish opening balances (see below) if not already present
2. Read the raw data, `policy.md`, and `event-schema.md`
3. Normalize into chronological order if the source is not already sorted
4. Capture the source's opening balance, closing balance, expected row count, total debits, and total credits before writing events
5. Parse each row into a ledger event, classifying per the policy
6. Separate operating activity from taxes, owner distributions, internal transfers, and capital items
7. When the source supports a durable accounting judgment, append a `treatment` event tied to the imported fact or document
8. Tag each event with a confidence level: `clear`, `inferred`, or `unclear`
9. Include a stable `data.ref` derived from the source row for idempotent re-import
10. Output as JSONL, run `clawbooks import check` with statement expectations, then pipe to `clawbooks batch`
11. Run `clawbooks verify` and `clawbooks reconcile` with the source totals

Use `clawbooks import scaffold <kind>` for editable import templates. Run `--help` for available kinds and flags.

For recurring description hints, use `clawbooks import mappings suggest` and keep optional hints in `vendor-mappings.json`. Mappings are advisory — they do not override `policy.md`.

This workflow applies to statement-like sources generally: bank statements, card exports, processor settlements, exchange cash reports, and other row-based account activity exports.

### Overlapping sources and double-counting

When importing from multiple sources, the same economic event often appears in more than one. A fiat withdrawal from an exchange shows up on both the exchange export and the bank statement. A card payment appears on both the card export and a receipt.

Each economic event should be recorded once. When sources overlap:

1. Identify which source is authoritative for a given transaction (usually the one closest to the cash movement)
2. Import from the authoritative source
3. Use the other source for verification or enrichment, not as a second ledger entry
4. If both sources are already imported, match them by date, amount, and counterparty — record one and tag the other as an internal movement or skip it
5. Use `verify` to check that totals are not inflated by double-counting

`policy.md` may declare source-specific matching rules for the entity's accounts. When it does not, apply the general principle: one fact, one event.

## Opening balances

The ledger needs a starting position before transaction-level imports make sense. One `opening_balance` event per account/currency pair, with positive = asset, negative = liability.

### When you have prior-period financials

If the user provides prior-period annual financial statements, a trial balance, or other summary documents but no transaction-level history for that period, extract opening balances from them. These are the closing positions of the prior period and become the opening positions of the current one.

Tag inferred opening balances honestly:
- `confidence: "inferred"`
- `data.source_doc` pointing to the prior-period document
- `data.provenance` noting what was extracted and any assumptions

Do not import prior-period summary documents as transaction events. They are not ledger facts for the current books — they are evidence for the starting position.

### When you have statement opening balances

The ledger needs exactly one `opening_balance` event per account/currency — the starting position. When importing the first statement for an account, use its declared opening balance as the ledger's `opening_balance` event with `confidence: "clear"`.

Subsequent statements' opening and closing balances are verification data, not ledger events. Use them with `clawbooks verify --balance --opening-balance` to confirm the ledger's computed position matches what the statement declares. If it mismatches, investigate — don't record a second opening balance.

### When real history arrives later

Inferred opening balances can be superseded without breaking the ledger. The ledger is append-only, so the pattern is:

1. Record `correction` events against each inferred `opening_balance`, setting the corrected amount to zero and noting the reason (e.g., "superseded by imported history")
2. Import the real historical events, which now provide the true cumulative position
3. If needed, record new `opening_balance` events at the actual starting point with `confidence: "clear"`

`summary` applies corrections automatically — the inferred balances drop out of reported totals. The original events remain in the chain for audit trail.

This means the agent should never hesitate to record inferred opening balances from the best available evidence. They are placeholders, not permanent commitments.

## Reporting

Start with `summary`, not `context`. Use `context` only when you need event-level reasoning.

| Question | Command |
|---|---|
| Aggregates, P&L inputs | `summary` |
| Event-level investigation | `context` |
| Receivables, payables, aging | `documents` |
| Asset register, depreciation | `assets` |
| Items needing review | `review` |
| Integrity and source-total checks | `verify`, `reconcile` |
| Audit-ready export | `pack` |

### Canonical finalized report output

When producing a finalized report for a host, UI, or audit workflow, the canonical output should be a structured reporting artifact.

That artifact should contain:

- views
- rows
- contributors
- anchors to facts, documents, treatments, snapshots, and evidence locators
- checks and exceptions
- workflow and fingerprint metadata

Do not produce two independently-authored versions of the same report by default.

If human-facing markdown, HTML, or PDF is needed, treat it as a rendering derived from the structured artifact rather than a separate report authority.

Do not dump chain-of-thought or verbose reasoning traces into the artifact.

### Mapping to financial statements

**P&L**: Use `movement_summary`, `report_sections`, and `report_totals` from `summary` as raw aggregates. Apply the accounting basis from `policy.md` to determine recognized revenue and expenses. Under accrual, include document events. Under cash, include only cash events.

**Balance sheet**: `cash_flow.net` + opening balance (from snapshot or `opening_balance` events) gives assets. Capitalized assets from `clawbooks assets`. Equity = Assets - Liabilities. Under accrual, include outstanding receivables and payables.

**Cash flow**: Map categories to Operating / Investing / Financing per policy.

### Documents and accounting basis

Under **cash basis**, documents (`invoice`, `bill`) are tracking events. Revenue and expense are recognized when the corresponding cash event hits the ledger.

Under **accrual basis**, the document is the recognition event. The subsequent cash event settles the receivable or payable.

The agent matches cash events to documents by `invoice_id` and reports:
- Outstanding receivables (issued documents without matching cash-in)
- Outstanding payables (received documents without matching cash-out)
- Aging by `due_date`
- Partial and over-payments

## Classification review

After import, run `clawbooks review` to see items needing attention. Review returns a materiality-first queue with a `reason_in_queue` per item.

To reclassify, record an append-only `reclassify` event. For non-category fixes, record a `correction` event. To mark reviewed items, record a `confirm` event. These are audit events — they adjust interpretation without rewriting history.

For bulk operations, use `clawbooks review batch` to generate JSONL action files, then pipe to `clawbooks batch`.

`summary` automatically applies reclassifications. `review` excludes already-reclassified events.

### Improving the policy

When you see repeated corrections (e.g., "GITHUB" always reclassified to `software`), suggest updating `policy.md` with the learned rule. Each import should get more accurate as the policy captures patterns. Do not update the policy without the user's awareness.

## Capitalization and asset lifecycle

When a purchase meets the capitalization threshold declared in `policy.md`, record a `capitalize_asset` treatment tied to the purchase event. The `assets` command reads those treatments and computes depreciation from them.

**Disposal** (sold/traded): Record a `disposal` event with `data.asset_id` and `data.proceeds`. Gain/loss = proceeds - net book value at disposal date.

**Write-off** (destroyed/obsolete): Record a `write_off` event with `data.asset_id`. Remaining NBV becomes a loss.

**Impairment** (value reduced, still in use): Record an `impairment` event with `data.asset_id` and `data.impairment_amount`. Reduces carrying value. Multiple impairments accumulate.

## Data conventions

`event-schema.md` is the authority for event encoding, field names, sign conventions, and the `data.*` extension surface. Read it before extending event shapes.

`policy.md` is the authority for entity-level interpretation, recognition, categorization, and reporting.

`treatment` events are the authority for durable case-level accounting judgment already made against specific facts or documents.

Brief pointers for common patterns:
- **FX / valuation**: `data.base_amount`, `data.fx_rate`, `data.base_currency` — store at ingestion time to avoid re-fetching historical prices
- **Lot tracking**: `data.lot_id` (acquisition), `data.lot_ref` (single disposition), `data.disposition_lots` (multi-lot disposition)
- **Provenance**: `data.ref`, `data.source_doc`, `data.source_row`, `data.source_hash`
- **Review**: `reclassify`, `correction`, `confirm` — append-only audit events
- **Durable judgment**: `treatment`, `treatment_supersede` — append-only accounting positions reused by later reports

## Uncertainty and provisional work

If `policy.md` is generic, incomplete, or unread for the current run:

1. You may still proceed with import and reporting
2. You must say the output is provisional
3. You must state the material assumptions you made
4. You must flag uncertain classifications when they could change the answer
5. You should suggest the minimum policy refinements that would improve future runs

Record events with honest `confidence` fields. Use `verify`, `reconcile`, `review`, and `documents` to narrow uncertainty. Surface unresolved issues in the final answer.

## Books directory

Clawbooks stores data in a `.books/` directory. Run `clawbooks where` to confirm which books, ledger, and policy resolved.

Resolution order: `CLAWBOOKS_LEDGER`/`CLAWBOOKS_POLICY` env vars > `CLAWBOOKS_BOOKS` env var > `--books` flag > walk up from CWD for `.books/` > bare `./ledger.jsonl` > auto-create on first write.

### Multi-entity

Each entity gets its own books directory with its own ledger and policy. Switch with `--books` or `CLAWBOOKS_BOOKS`. No cross-entity CLI commands — the agent handles inter-entity reasoning. Link inter-entity transactions by `data.ref`.

### Snapshots and compaction

For large ledgers, use `clawbooks snapshot` to create derived checkpoints and `clawbooks compact` to archive old periods. The archive is a complete hash-chained ledger for audits. The main ledger stays small for fast context loading.

## Period format

All period arguments support: `2026` (year), `2026-03` (month), `FY2025` (fiscal year per `policy.md`), `2026-01/2026-06-30` (range).
