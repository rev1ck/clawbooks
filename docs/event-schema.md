# Clawbooks Event Schema

This document defines the canonical ledger event schema for `clawbooks`.

It is intended to be stable for a very long time.

The core design is deliberately small:

- the ledger stores facts
- `policy.md` defines interpretation
- the agent/operator decides how raw source material becomes events

The schema is therefore optimized for durability, auditability, and extensibility rather than for embedding accounting judgment into the storage layer.

## Design Principles

The event schema should preserve these principles:

1. Facts before interpretation.
   Store what happened, when it happened, where it came from, and how it was traced. Put recognition rules, policy choices, and reporting judgment in `policy.md`, not in the ledger format itself.
2. Append-only history.
   Do not rewrite prior rows in place. Use follow-up audit events such as `reclassify`, `correction`, and `confirm`.
3. Stable envelope, flexible payload.
   The top-level event shape should remain small and stable. Most evolution should happen inside `data`.
4. Deterministic identity.
   The same normalized fact should produce the same event identity.
5. Explicit provenance.
   Events should be traceable back to source records, documents, statements, or operator actions.
6. Additive evolution.
   New optional fields and new event types are fine. Reinterpreting old fields or overloading existing meanings is not.

## Canonical Stored Row

Each ledger row is one JSON object.

```json
{
  "ts": "2026-03-18T09:30:00.000Z",
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": -125.50,
    "currency": "USD",
    "description": "AWS March hosting",
    "category": "hosting",
    "confidence": "clear"
  },
  "id": "generated-by-cli",
  "prev": "generated-by-cli"
}
```

## Top-Level Fields

| Field | Required in stored row | Required on input | Meaning |
|---|---:|---:|---|
| `ts` | yes | no | ISO-8601 event timestamp. If omitted on input, the CLI uses current time. |
| `source` | yes | yes | Source system, workflow, or operator channel, e.g. `bank`, `stripe`, `manual`, `review`. |
| `type` | yes | yes | Event class, e.g. `expense`, `income`, `invoice`, `snapshot`. |
| `data` | yes | yes | Event payload. This is where most schema evolution should occur. |
| `id` | yes | no | Deterministic id derived by the CLI from `source`, `type`, `ts`, and `data`. |
| `prev` | yes | no | Hash-chain pointer to the previous stored row. `genesis` for the first row. |

## Invariants

These are the invariants the canonical schema assumes:

- The ledger row envelope is stable: `ts`, `source`, `type`, `data`, `id`, `prev`.
- `data` is always an object.
- `id` is deterministic for a normalized event.
- `prev` links rows into an append-only chain.
- Unknown additional fields may exist inside `data`.
- New event `type` values may be added over time.
- Existing field meanings should not be repurposed.

## Minimum Requirements

For most financial movement events, provide at least:

- `source`
- `type`
- `data.amount`
- `data.currency`

Current CLI exceptions to the currency requirement:

- `snapshot`
- `reclassify`
- `opening_balance`
- `correction`
- `confirm`

Recommended baseline fields for most money-movement events:

- `data.amount`
- `data.currency`
- `data.description`
- `data.category`
- `data.confidence`
- `data.ref`

## Stored Form vs Input Form

The CLI may accept a slightly looser input shape than the stored ledger row.

Examples:

- `ts` may be omitted on input and will default to now.
- `id` and `prev` should not normally be supplied by the caller.
- some signs are normalized by the CLI according to event type conventions.

When this document says "canonical", it refers to the stored ledger form, not merely the most convenient ingestion payload.

## Sign Conventions

The CLI normalizes sign for known types.

### Stored negative

- `expense`
- `tax_payment`
- `owner_draw`
- `fee`
- `dividend`
- `loan_repayment`
- `refund`
- `transfer_out`
- `withdrawal`

### Stored positive

- `income`
- `deposit`
- `equity_injection`
- `loan_received`
- `transfer_in`
- `refund_received`
- `grant`

### Document types

- `invoice`
- `bill`

For documents, sign is derived from `data.direction`:

- `issued` => positive
- `received` => negative

If `data.direction` is absent, sign is not enforced.

### Sign not enforced by the CLI

- `snapshot`
- `reclassify`
- `opening_balance`
- `correction`
- `confirm`
- `disposal`
- `write_off`
- `impairment`
- unknown custom types

If you introduce a custom type, store the sign you actually mean and make the policy explicit.

## Event Type Taxonomy

The ledger format does not require a closed list of event types, but the following classes are canonical within clawbooks today.

### Core cash and financing types

| Type | Typical meaning |
|---|---|
| `income` | Operating inflow or recognized revenue cash-in |
| `expense` | Operating outflow |
| `fee` | Bank or processor fee |
| `tax_payment` | Tax remittance |
| `deposit` | Cash deposited into an account |
| `withdrawal` | Cash withdrawn from an account |
| `transfer_in` | Internal transfer into an account |
| `transfer_out` | Internal transfer out of an account |
| `equity_injection` | Owner or shareholder capital contribution |
| `owner_draw` | Owner distribution or draw |
| `loan_received` | Borrowing proceeds |
| `loan_repayment` | Debt principal repayment |
| `refund_received` | Refund back to the entity |
| `refund` | Refund paid out by the entity |
| `grant` | Grant or subsidy receipt |

### Document types

| Type | Typical meaning |
|---|---|
| `invoice` | Issued or received financial document |
| `bill` | Alternative document label for a payable or received invoice |

Use `data.direction` to indicate whether the document is `issued` or `received`.
Use `data.invoice_id` to connect later settlement events.

### Audit and lifecycle types

| Type | Meaning |
|---|---|
| `reclassify` | Append-only reinterpretation of category or type for an existing event |
| `correction` | Append-only correction record against an existing event |
| `confirm` | Explicit review confirmation of an existing event |
| `snapshot` | Stored derived checkpoint used to accelerate later reasoning |
| `opening_balance` | Starting account or liability state before later imports |

### Asset lifecycle types

| Type | Meaning |
|---|---|
| `disposal` | Asset sale or disposal referencing `data.asset_id` |
| `write_off` | Asset removal or loss referencing `data.asset_id` |
| `impairment` | Asset impairment referencing `data.asset_id` |

## Recommended `data.*` Fields

The CLI does not require all of these. They are conventions that make the ledger more durable and agent workflows more reliable.

### Generic event fields

| Field | Use |
|---|---|
| `amount` | Signed monetary amount in transaction currency |
| `currency` | Transaction currency, e.g. `USD` |
| `description` | Human-readable description of the event |
| `category` | Policy-facing category label |
| `confidence` | Suggested review state: `clear`, `inferred`, `unclear`, or omitted |
| `ref` | Stable import identity or upstream reference |
| `counterparty` | Vendor, customer, bank, exchange, or other party |
| `account` | Account identifier, e.g. `checking`, `credit_card`, `wallet:usdc` |

### Provenance fields

| Field | Use |
|---|---|
| `source_doc` | Filename, URL, statement id, or source artifact label |
| `source_row` | Row number or record index in the upstream source |
| `source_hash` | Fingerprint of the source row or document |
| `provenance` | Extraction notes or free-form trace |
| `recorded_by` | Human or agent identity |
| `recorded_via` | Import path or tool name |
| `import_session` | Batch or run identifier |

### Document linkage fields

| Field | Use |
|---|---|
| `invoice_id` | Stable document identifier used to match settlements |
| `direction` | `issued` or `received` |
| `due_date` | Due date for aging and open document views |
| `counterparty` | Customer or vendor |

### Asset fields

| Field | Use |
|---|---|
| `capitalize` | `true` if the event should appear in the asset register |
| `useful_life_months` | Override default life for depreciation |
| `asset_id` | Event id of the original capitalized purchase |
| `impairment_amount` | Amount used on impairment events |
| `proceeds` | Disposal proceeds |

### FX and valuation fields

| Field | Use |
|---|---|
| `fx_rate` | Transaction-time FX rate |
| `base_currency` | Base or reporting currency |
| `price_usd` | USD unit or event price |
| `price_source` | Price feed or provider |
| `valuation_ts` | Timestamp for the valuation fact |

### Lot tracking fields

| Field | Use |
|---|---|
| `lot_id` | New lot created by an acquisition |
| `lot_ref` | Single referenced lot on a disposition |
| `disposition_lots` | Array of lot fragments consumed by a disposition |

## Event Shapes by Use Case

### Expense

Input shape:

```json
{
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": 125.50,
    "currency": "USD",
    "description": "AWS March hosting",
    "category": "hosting",
    "confidence": "clear",
    "ref": "txn_123",
    "source_doc": "bank-march.csv",
    "source_row": 42,
    "recorded_by": "codex",
    "import_session": "bank-2026-03"
  }
}
```

Stored form:

```json
{
  "ts": "2026-03-18T09:30:00.000Z",
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": -125.50,
    "currency": "USD",
    "description": "AWS March hosting",
    "category": "hosting",
    "confidence": "clear",
    "ref": "txn_123",
    "source_doc": "bank-march.csv",
    "source_row": 42,
    "recorded_by": "codex",
    "import_session": "bank-2026-03"
  },
  "id": "generated-by-cli",
  "prev": "generated-by-cli"
}
```

### Income

```json
{
  "source": "stripe",
  "type": "income",
  "data": {
    "amount": 1700,
    "currency": "USD",
    "description": "Consulting payout",
    "category": "services_revenue",
    "counterparty": "Acme",
    "ref": "po_987"
  }
}
```

### Issued invoice

```json
{
  "source": "manual",
  "type": "invoice",
  "data": {
    "amount": 5000,
    "currency": "USD",
    "direction": "issued",
    "invoice_id": "INV-001",
    "counterparty": "Acme",
    "due_date": "2026-04-15",
    "description": "March consulting"
  }
}
```

### Cash settlement against invoice

```json
{
  "source": "bank",
  "type": "income",
  "data": {
    "amount": 5000,
    "currency": "USD",
    "invoice_id": "INV-001",
    "counterparty": "Acme",
    "description": "Payment for INV-001"
  }
}
```

### Opening balance

```json
{
  "source": "manual",
  "type": "opening_balance",
  "ts": "2026-01-01T00:00:00.000Z",
  "data": {
    "amount": 50000,
    "currency": "USD",
    "account": "checking",
    "category": "cash"
  }
}
```

Convention:

- positive amount => asset
- negative amount => liability

### Capitalized asset purchase

```json
{
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": 15000,
    "currency": "USD",
    "description": "MacBook Pro",
    "category": "hardware",
    "capitalize": true,
    "useful_life_months": 36
  }
}
```

### Snapshot event

```json
{
  "source": "clawbooks:snapshot",
  "type": "snapshot",
  "data": {
    "period": {
      "after": "2026-03-01T00:00:00.000Z",
      "before": "2026-03-31T23:59:59.999Z"
    },
    "event_count": 42,
    "balances": {
      "USD": 15250
    },
    "by_category": {
      "services_revenue": 1700,
      "hosting": -125.5
    },
    "movement_summary": {},
    "report_sections": {},
    "report_totals": {}
  }
}
```

Snapshots are derived checkpoints, not source-of-truth accounting entries.

### Reclassification audit event

```json
{
  "source": "review",
  "type": "reclassify",
  "data": {
    "original_id": "abcd1234",
    "new_category": "software",
    "new_type": "expense",
    "reason": "AWS support charge was miscategorized as hosting"
  }
}
```

### Correction audit event

```json
{
  "source": "review",
  "type": "correction",
  "data": {
    "original_id": "abcd1234",
    "reason": "Wrong counterparty and reference",
    "corrected_fields": {
      "counterparty": "Amazon Web Services",
      "ref": "txn_456"
    }
  }
}
```

### Confirmation audit event

```json
{
  "source": "review",
  "type": "confirm",
  "data": {
    "original_id": "abcd1234",
    "confidence": "clear",
    "confirmed_by": "martin"
  }
}
```

## Snapshot Semantics

A snapshot is a derived checkpoint written into the ledger.

- It is not the canonical source of truth.
- It is not a substitute for the underlying event history.
- It exists to accelerate later reasoning, context generation, and compaction workflows.

## Ingestion Guidance

When normalizing raw sources into clawbooks events:

1. Sort statement-like inputs into chronological order.
2. Capture opening balance, closing balance, expected row count, debits, and credits before import.
3. Preserve provenance fields so every material event can be traced back to source material.
4. Normalize signs using the canonical type conventions.
5. Attach stable references where available, such as `ref`, `invoice_id`, or upstream ids.
6. Keep categories policy-facing rather than source-facing where possible.
7. Use `confidence` when classification is uncertain.

## What the Schema Does Not Decide

The schema stores events and preserves audit history. It does not itself decide:

- recognition timing
- cost basis method
- capitalization thresholds
- tax treatment
- final category policy
- whether one source row should become one event or several

Those belong in `policy.md` and in the agent/operator workflow.

## Practical Rule

Keep the ledger factual, the policy explicit, and the interpretation reversible.
