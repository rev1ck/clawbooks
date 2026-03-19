# Clawbooks Event Schema

This document defines the canonical ledger event schema for `clawbooks`.

The schema is designed for historical ledger stability:

- the ledger stores facts
- `policy.md` defines interpretation
- the agent/operator decides how raw material becomes events

The storage layer should remain small, durable, and additive.

## Status

- Status: canonical
- Scope: stored ledger rows in `ledger.jsonl`
- Goal: preserve long-term readability and auditability of historical ledgers

## Normative Terms

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used in their plain normative sense.

## Design Rules

1. Facts before interpretation.
   The ledger MUST store what happened, when, from where, and with what traceability. Recognition policy, tax treatment, reporting basis, and classification judgment belong in `policy.md`.
2. Append-only history.
   Historical rows MUST NOT be rewritten in place. Later reinterpretation SHOULD be represented by follow-up audit events.
3. Stable envelope.
   The top-level row shape MUST remain stable. Most schema evolution SHOULD occur inside `data`.
4. Additive evolution.
   New optional fields and new event types MAY be added. Existing field meanings MUST NOT be repurposed.
5. Deterministic identity.
   The same normalized fact SHOULD produce the same event identity.

## Canonical Stored Row

Each stored row MUST be a JSON object with this top-level envelope:

```json
{
  "ts": "2026-03-18T09:30:00.000Z",
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": -125.50,
    "currency": "USD",
    "description": "AWS March hosting",
    "category": "hosting"
  },
  "id": "generated-by-cli",
  "prev": "generated-by-cli"
}
```

## Top-Level Fields

| Field | Stored row | Input | Meaning |
|---|---:|---:|---|
| `ts` | required | optional | ISO-8601 event timestamp |
| `source` | required | required | source system, workflow, or operator channel |
| `type` | required | required | event class |
| `data` | required | required | event payload object |
| `id` | required | optional | deterministic id generated from `source`, `type`, `ts`, and `data` |
| `prev` | required | optional | hash-chain pointer to the previous stored row |

## Invariants

Historical ledger rows MUST preserve these invariants:

- the top-level envelope is exactly `ts`, `source`, `type`, `data`, `id`, `prev`
- `data` is an object
- `id` identifies the normalized event
- `prev` links the append-only chain
- additional fields MAY exist inside `data`
- new `type` values MAY be introduced
- existing field meanings MUST remain stable

## Stored Form vs Input Form

The canonical schema describes the stored ledger row, not the loosest accepted input.

In the current CLI:

- `ts` MAY be omitted on input and default to now
- `id` and `prev` SHOULD NOT be supplied by the caller
- sign MAY be normalized on input for known event types

## Minimum Event Requirements

For most financial movement events, callers SHOULD provide at least:

- `source`
- `type`
- `data.amount`
- `data.currency`

Current CLI currency exemptions:

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

For document types:

- `data.direction = "issued"` => positive
- `data.direction = "received"` => negative

If `data.direction` is absent, sign is not enforced.

### Sign not enforced

- `snapshot`
- `reclassify`
- `opening_balance`
- `correction`
- `confirm`
- `disposal`
- `write_off`
- `impairment`
- unknown custom types

Custom types MAY be introduced, but their sign semantics SHOULD be made explicit in `policy.md`.

## Canonical Type Families

The schema does not require a closed type list, but these families are canonical in clawbooks.

### Cash and financing

`income`, `expense`, `fee`, `tax_payment`, `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `equity_injection`, `owner_draw`, `loan_received`, `loan_repayment`, `refund_received`, `refund`, `grant`

### Documents

`invoice`, `bill`

Document events SHOULD use:

- `data.direction`
- `data.invoice_id`
- `data.counterparty`
- `data.due_date`

### Audit and lifecycle

`reclassify`, `correction`, `confirm`, `snapshot`, `opening_balance`

### Asset lifecycle

`disposal`, `write_off`, `impairment`

## Recommended `data.*` Fields

These fields are conventions, not universal requirements.

### Generic

| Field | Meaning |
|---|---|
| `amount` | signed monetary amount |
| `currency` | transaction currency |
| `description` | human-readable description |
| `category` | policy-facing category label |
| `confidence` | review state such as `clear`, `inferred`, `unclear` |
| `ref` | stable import identity or upstream reference |
| `counterparty` | other party |
| `account` | account identifier |

### Provenance

| Field | Meaning |
|---|---|
| `source_doc` | source artifact label |
| `source_row` | upstream row or record index |
| `source_hash` | fingerprint of source material |
| `provenance` | extraction notes |
| `recorded_by` | human or agent identity |
| `recorded_via` | import path or tool |
| `import_session` | batch or run identifier |

### Documents

| Field | Meaning |
|---|---|
| `invoice_id` | stable document identifier |
| `direction` | `issued` or `received` |
| `due_date` | due date for aging/open items |

### Assets

| Field | Meaning |
|---|---|
| `capitalize` | include in asset register |
| `useful_life_months` | depreciation life override |
| `asset_id` | original capitalized event id |
| `impairment_amount` | impairment value |
| `proceeds` | disposal proceeds |

### FX and lot tracking

Common optional fields:

- `fx_rate`
- `base_currency`
- `price_usd`
- `price_source`
- `valuation_ts`
- `lot_id`
- `lot_ref`
- `disposition_lots`

## Canonical Event Shapes

Only a few examples are kept here. They define the shape classes that matter most.

### Expense

Input:

```json
{
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": 125.50,
    "currency": "USD",
    "description": "AWS March hosting",
    "category": "hosting",
    "ref": "txn_123"
  }
}
```

Stored effect: amount is normalized negative.

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
    "due_date": "2026-04-15"
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

## Schema Evolution Rules

To preserve historical ledger stability:

- future tooling MUST continue to read old rows with the same top-level envelope
- old field meanings MUST remain unchanged
- new optional `data.*` fields MAY be added
- new `type` values MAY be added
- future tooling SHOULD ignore unknown `data.*` fields unless explicitly taught to use them
- future tooling SHOULD treat unknown `type` values as valid stored facts, not as corrupt rows
- removing canonical top-level fields MUST NOT happen without a formal ledger migration strategy

## What the Schema Does Not Decide

The schema does not decide:

- recognition timing
- cost basis method
- capitalization thresholds
- tax treatment
- final category policy
- whether one source row should become one event or several

Those belong in `policy.md` and in the agent/operator workflow.

## Practical Rule

Keep the ledger factual, the policy explicit, and the interpretation reversible.
