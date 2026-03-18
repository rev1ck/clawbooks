# Clawbooks

You have access to `clawbooks`, a CLI tool for financial record-keeping.
The ledger is an append-only JSONL file. The accounting policy is a markdown file.
You are the accountant. The CLI is just data storage.

## Reading the books

To answer any financial question, first load context:

```bash
clawbooks context 2026-03             # compact context for a specific month
clawbooks context 2026-03 --verbose   # full raw payloads for the period
clawbooks context 2026-03 --include-policy
                                      # inline the full policy in the context envelope
clawbooks context --after 2026-01-01  # everything since a date
clawbooks context                     # everything (small ledgers)
```

This prints metadata, instructions, the latest snapshot, and the events
in the period. Read the policy separately, then use the context output to answer the question.

## Writing events

To record a financial event:

```bash
clawbooks record '{"source":"stripe","type":"income","data":{"amount":500,"currency":"USD","customer":"acme"}}'
```

Required fields: `source`, `type`, `data` (any object). `ts` is optional (defaults to now).
`data.currency` is **required** — the ledger rejects events without it (except snapshots, reclassify, opening_balance).

The CLI enforces sign convention automatically for known types:
- **Outflow** (stored negative): `expense`, `tax_payment`, `owner_draw`, `fee`, `dividend`, `loan_repayment`, `refund`, `transfer_out`, `withdrawal`
- **Inflow** (stored positive): `income`, `deposit`, `equity_injection`, `loan_received`, `transfer_in`, `refund_received`, `grant`
- **Document types** (sign based on `data.direction`): `invoice`, `bill` — `issued` stores positive, `received` stores negative. If direction is absent, sign is not enforced
- **Meta types** (sign not enforced): `snapshot`, `reclassify`, `opening_balance`
- **Asset events** (sign not enforced): `disposal`, `write_off`, `impairment`
- **Unknown types**: the CLI warns and preserves the sign you provide. Use critical thinking — if a new type represents money leaving the business, pass a negative amount. `verify` will flag sign inconsistencies.

The ledger is hash-chained — each event's `prev` field links to the previous event.

For bulk data, output JSONL and pipe it:

```bash
echo '{"source":"bank","type":"income","data":{"amount":1000,"currency":"USD"}}
{"source":"bank","type":"fee","data":{"amount":25,"currency":"USD","desc":"Monthly fee"}}' | clawbooks batch
```

## Opening balances

Before importing transaction data, record opening balances for each account/currency. One event per account/currency:

```bash
clawbooks record '{"source":"manual","type":"opening_balance","ts":"2025-01-01T00:00:00.000Z","data":{"amount":50000,"currency":"USD","account":"checking","category":"cash"}}'
clawbooks record '{"source":"manual","type":"opening_balance","ts":"2025-01-01T00:00:00.000Z","data":{"amount":-12000,"currency":"USD","account":"credit_card","category":"liability"}}'
```

Convention:
- Positive amount = asset (cash, receivables, equipment)
- Negative amount = liability (credit cards, loans)
- `data.category`: `cash`, `asset`, `liability`, or `equity`
- `data.account`: identifies which account (e.g., `checking`, `credit_card`)
- One event per account/currency pair
- `opening_balance` is exempt from currency requirement and sign enforcement

## Invoices and bills

Record financial documents — invoices issued to customers, invoices or bills received from vendors — as they occur:

Document issued (receivable):
```bash
clawbooks record '{"source":"manual","type":"invoice","data":{"amount":5000,"currency":"USD","direction":"issued","counterparty":"acme","invoice_id":"INV-001","due_date":"2026-04-15","description":"March consulting"}}'
```

Document received (payable):
```bash
clawbooks record '{"source":"manual","type":"invoice","data":{"amount":2000,"currency":"USD","direction":"received","counterparty":"aws","invoice_id":"BILL-001","due_date":"2026-04-01","description":"March hosting"}}'
```

Some jurisdictions distinguish "invoice" (issued) from "bill" (received). Both type names are supported and treated identically by the CLI. Use whichever term fits your jurisdiction. The `data.direction` field ("issued" or "received") is the authoritative indicator of whether a document represents a receivable or payable.

When payment is received or made, reference the document:
```bash
clawbooks record '{"source":"bank","type":"income","data":{"amount":5000,"currency":"USD","counterparty":"acme","invoice_id":"INV-001","description":"Payment for INV-001"}}'
```

How documents affect reports depends on the accounting basis declared in policy.md:

- **Accrual basis**: the document is the recognition event. Revenue or expense is recognized when the document is recorded. The subsequent cash event settles the receivable/payable.
- **Cash basis**: the document is a tracking event. Revenue or expense is recognized when the corresponding cash event hits the ledger. Documents inform the agent about expected future flows.

The agent matches cash events to documents by `invoice_id` and reports:
- Outstanding receivables (issued documents without matching cash-in)
- Outstanding payables (received documents without matching cash-out)
- Aging by due_date
- Partial and over-payments

The CLI stores all events and surfaces them in context. The agent applies policy.md to decide what's recognized and how to present reports.

## Importing messy data (CSVs, statements, etc.)

When the user gives you a CSV or other raw financial data:

1. Record opening balances first (if not already present)
2. Read the raw data and the policy (`clawbooks policy` or the file at `CLAWBOOKS_POLICY`)
3. If the source is newest-first or otherwise unsorted, normalize it into chronological order before importing
4. Capture the source's opening balance, closing balance, expected row count, total debits, and total credits before writing events
5. Parse each row into a ledger event, classifying per the policy
6. Separate operating activity from taxes, owner distributions, internal transfers, and capital items while importing
7. For hardware/equipment purchases that meet the capitalization threshold, set `data.capitalize: true` and optionally `data.useful_life_months`
8. Output as JSONL and pipe to `clawbooks batch`
9. Run `clawbooks reconcile <period> --source <source> --count <rows> --debits <debits> --credits <credits>` to compare imported totals to the source extract
10. Run `clawbooks verify <period> --balance <closing_balance> --opening-balance <opening_balance> --currency <currency>` when the source provides statement balances

You are the parser. There is no import tool. You read the data and write the events.

This workflow applies to statement-like sources generally: bank statements, card exports, processor settlements, exchange cash reports, and other row-based account activity exports.

## Capitalizing assets

When an expense meets the capitalization threshold (see policy), set `data.capitalize: true` on the event:

```bash
clawbooks record '{"source":"bank","type":"expense","ts":"2025-09-15T00:00:00.000Z","data":{"amount":15000,"currency":"USD","description":"MacBook Pro","category":"hardware","capitalize":true,"useful_life_months":36}}'
```

- `data.capitalize: true` — marks the event for the asset register
- `data.useful_life_months` — overrides the default useful life (default: 36 months)
- The `assets` command finds all events with `capitalize: true` and computes depreciation
- `--category` on the `assets` command is an optional filter, not the selection mechanism

## Asset lifecycle

After capitalizing an asset, you can record disposal, write-off, or impairment events. These reference the original asset by its event ID via `data.asset_id`:

**Disposal** (sold or traded in):
```bash
clawbooks record '{"source":"manual","type":"disposal","data":{"asset_id":"abc123","proceeds":5000,"currency":"USD"}}'
```
Gain/loss = proceeds - net book value at time of disposal.

**Write-off** (destroyed, stolen, obsolete):
```bash
clawbooks record '{"source":"manual","type":"write_off","data":{"asset_id":"abc123","currency":"USD"}}'
```
Remaining NBV becomes a loss.

**Impairment** (value reduced but still in use):
```bash
clawbooks record '{"source":"manual","type":"impairment","data":{"asset_id":"abc123","impairment_amount":3000,"currency":"USD"}}'
```
Reduces carrying value by the impairment amount. Multiple impairments can accumulate.

## Generating reports

When asked for a P&L, tax summary, balance, etc.:

1. **Start with `summary`**, not `context`. `clawbooks summary <period>` gives you pre-computed aggregates without loading every event into context.
2. Map the output to the requested report:
   - **P&L**: use `movement_summary`, `report_sections`, and `report_totals` as raw aggregates. Apply the accounting basis from policy.md to determine what counts as recognized revenue and expenses. Under accrual, include document events; under cash, include only cash events.
   - **Balance Sheet**: `cash_flow.net` + opening balance (from snapshot or opening_balance events) → Assets. Capitalized assets from `clawbooks assets`. Equity = Assets - Liabilities. Under accrual, include outstanding receivables and payables from document events.
   - **Cash Flow Statement**: Map categories to Operating/Investing/Financing per policy
3. Only use `clawbooks context <period>` when you need to drill into individual events — e.g., investigating a specific transaction, answering "what was that $500 charge?", or debugging a reconciliation mismatch.
4. For large ledgers, use `clawbooks pack <period>` to generate a full audit pack (CSVs + JSON) that you or an accountant can review outside the agent.

## Reconciliation workflow

After importing data from any source:

1. During import, compute expected totals (count, debits, credits) from the source data
2. Run `clawbooks verify <period> --source S` to check integrity (totals, hash, issues)
3. Run `clawbooks verify <period> --balance <closing_balance> --opening-balance <opening_balance> --currency USD` when the source provides opening and closing balances
4. Run `clawbooks reconcile <period> --source S --count N --debits N --credits N --gaps` to compare and detect date gaps
5. Review `potential_duplicates` in verify output — same source/date/amount/description
6. If `RECONCILED`, proceed. If `MISMATCH`, investigate and fix before generating reports
7. Include the verify hash in report footers for audit trail

### Document-to-payment reconciliation

After importing bank data, the agent should:
1. Match cash-in events to issued documents by invoice_id
2. Match cash-out events to received documents by invoice_id
3. Report unmatched issued documents as outstanding receivables
4. Report unmatched received documents as outstanding payables
5. Flag partial payments and overpayments
6. Under accrual basis, verify that recognized revenue/expenses have corresponding documents

## Classification review

When importing events, set a `confidence` field in each event's data:
- `"clear"` — unambiguous classification (e.g., payroll labeled by bank)
- `"inferred"` — reasonable but uncertain (e.g., "AMZN" → office supplies)
- `"unclear"` — couldn't classify confidently

After import, run `clawbooks review <period> --source S` to see items needing review.

To reclassify an event, record an append-only correction:
```bash
clawbooks record '{"source":"manual","type":"reclassify","data":{"original_id":"abc123","new_category":"contractor"}}'
```

The `summary` command automatically applies reclassifications. The `review` command excludes already-reclassified events.

## Generating snapshots

When the ledger is large, generate a snapshot to keep future context bounded:

```bash
clawbooks snapshot 2026-03 --save   # compute and save to ledger
clawbooks snapshot 2026-03          # compute and print (no save)
```

The snapshot includes balances by currency, totals by category, and report-oriented sections for movement summary, tax, capex, owner distributions, transfers, and documents.

## Compacting the ledger

When the ledger grows large (thousands of events), compact old periods into an archive:

```bash
clawbooks compact 2025-12
```

This:
1. Saves a snapshot summarizing all events up to the cutoff
2. Moves those events to `ledger-archive-2025-12-31.jsonl`
3. Rewrites the main ledger with just the snapshot + newer events

The archive file is a complete, hash-chained ledger — it can be re-read for audits. The main ledger stays small for fast context loading.

Compact aggressively for busy ledgers. Monthly or quarterly compaction keeps context manageable.

## Audit packs

Generate a folder of CSVs and JSON for accountants, auditors, or your own review:

```bash
clawbooks pack 2026-03                      # pack a single month
clawbooks pack 2026-01/2026-12-31 --out ./annual-pack   # pack a full year
```

The pack includes:
- `general_ledger.csv` — every transaction with date, source, type, category, description, amount, currency, confidence, id
- `summary.json` — aggregates by type, category, currency, cash flow, plus report-oriented sections
- `asset_register.csv` — capitalized assets with depreciation, disposal, write-off status (if any)
- `reclassifications.csv` — all reclassification events (if any)
- `verify.json` — integrity hash, debit/credit totals, issues
- `policy.md` — copy of the accounting policy applied

These files are assistive — they give the accountant standard-format data to work with. The agent can also read them back to answer questions.

## Books directory

Clawbooks stores its data in a `.books/` directory:

```
.books/
  ledger.jsonl                  # append-only event ledger
  policy.md                     # accounting policy
  ledger-archive-*.jsonl        # from compact
  audit-pack-*/                 # from pack
```

### Setup

```bash
clawbooks init                         # creates .books/ in CWD
clawbooks init --books .books-personal # creates named books dir
clawbooks init --example simple        # use the cash-basis example
clawbooks init --example complex       # use the accrual/trading example
```

`init` seeds `policy.md` with a bundled example policy. The user or agent should edit it before relying on reports:
- Fill in entity name, jurisdiction, and base currency
- Declare cash vs accrual basis
- Add any tax, capitalization, AR/AP, and review rules

Examples:
- `default`: general-purpose starter policy
- `simple`: cash-basis operating business
- `complex`: accrual/trading-heavy example

### Resolution order

The CLI finds books in this priority:
1. `CLAWBOOKS_LEDGER` / `CLAWBOOKS_POLICY` env vars (direct file paths)
2. `CLAWBOOKS_BOOKS` env var (books directory)
3. `--books <dir>` global flag
4. Walk up from CWD looking for `.books/` containing `ledger.jsonl` or `policy.md`
5. Bare `./ledger.jsonl` in CWD (backward compat)
6. Auto-create `.books/` on first write command

Read-only commands (`log`, `context`, `summary`, `verify`, etc.) error with guidance if no books found.
Write commands (`record`, `batch`, `snapshot --save`, `compact`) auto-create `.books/` if nothing is found.
When books are auto-created, clawbooks also seeds a starter `policy.md`; treat that file as a draft and customize it.

### Multi-entity

Each entity gets its own books directory with its own ledger + policy:

```
project/
  .books/                  # primary entity (e.g., company)
    ledger.jsonl
    policy.md
  .books-personal/         # second entity
    ledger.jsonl
    policy.md
```

Switch entities with `--books` or `CLAWBOOKS_BOOKS`:

```bash
clawbooks --books .books-personal context 2026-03
CLAWBOOKS_BOOKS=.books-personal clawbooks summary 2026-03
alias claw-personal='CLAWBOOKS_BOOKS=.books-personal clawbooks'
```

Each entity's `policy.md` declares its own name, type, jurisdiction, currency, and rules.
There are no cross-entity CLI commands — the agent handles inter-entity reasoning.

For inter-entity transactions (e.g., owner pays business expense from personal account),
record one event in each ledger linked by `data.ref`.

## Quick reference

```
clawbooks init [--books DIR] [--example NAME]
                                     # create .books/ with ledger + seeded policy
clawbooks record <json>             # append one event
clawbooks batch                     # append JSONL from stdin
clawbooks log [--last N]            # view recent events
clawbooks context [period]          # load policy + events for reasoning
clawbooks policy                    # print policy.md
clawbooks stats                     # ledger overview
clawbooks verify [period]           # integrity + chain + balance check + duplicates
clawbooks verify --balance N        # cross-check closing balance against period movement
clawbooks verify --balance N --opening-balance N
                                     # cross-check closing balance against opening + movement
clawbooks reconcile [period] -S     # compare expected vs actual totals
clawbooks reconcile -S --gaps       # also detect date gaps >7 days
clawbooks review [period]           # show items needing classification review
clawbooks summary [period]          # aggregates + movement summary + report sections
clawbooks snapshot [period] [--save] # compute period snapshot (balances, movement summary, sections)
clawbooks assets [--category C] [--life N] [--as-of DATE]
                                     # asset register (capitalize-flag based)
clawbooks compact <period>           # archive old events, shrink ledger
clawbooks pack [period] [--out DIR]  # generate audit pack (CSVs + JSON)
```

## Improving the policy

The accounting policy (`policy.md`) should improve over time as you process more data. After classification review cycles:

1. Run `clawbooks review` to see reclassifications and patterns
2. If you notice repeated corrections (e.g., "GITHUB" always gets reclassified from `office_supplies` to `software`), update `policy.md` with the new rule
3. Add the rule to the appropriate section (expense classification, source-specific rules, etc.)
4. Be specific — "GitHub charges are software subscriptions" is better than "tech charges are software"

The goal is that each import gets more accurate as the policy captures learned patterns. The agent should proactively suggest policy updates when it sees recurring reclassifications, but should not update the policy without the user's awareness.

When updating the policy, keep it plain english. The policy is read by the agent on every `context` call — it should be clear, concise, and actionable.

## Idempotent imports

When importing from a source (CSV, statement), include a stable `data.ref` field derived
from the source row (e.g. hash of date + description + amount + running balance). This
ensures re-importing the same source file produces identical event IDs and gets deduplicated.
