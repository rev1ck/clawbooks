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
   The ledger MUST store what happened, when, from where, and with what traceability. General recognition policy, tax treatment, and reporting basis belong in `policy.md`; durable case-level accounting judgment belongs in append-only `treatment` events.
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

## `data` Extensibility

`data` is an open extension object.

This is a deliberate design choice.

- The schema MUST NOT assume a closed universal payload grammar inside `data`.
- Agents and operators MAY store additional source-specific, workflow-specific, jurisdiction-specific, or domain-specific fields inside `data`.
- Future tooling SHOULD preserve unrecognized `data.*` fields rather than dropping or rewriting them.
- Unknown `data.*` fields MUST NOT by themselves make an event invalid.

The schema is therefore prescriptive about:

- the stable top-level envelope
- the meaning of canonical fields already documented here
- the sign semantics of canonical event types

The schema is intentionally not prescriptive about:

- every possible `data.*` field that may appear
- a closed per-type payload schema for all future use cases

In practice, this means:

- use canonical fields when they fit
- add extra `data.*` fields when needed
- do not repurpose existing canonical field names to mean something else

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
- `treatment`
- `treatment_supersede`

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

### Treatments

`treatment`, `treatment_supersede`

Treatment events persist durable accounting positions such as capitalization, accrual timing, owner-boundary decisions, and classification overrides.

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

### Statement and source-date conventions

These fields are optional conventions for statement-style imports and other sources where multiple date concepts matter.

| Field | Meaning |
|---|---|
| `transaction_date` | economic or transaction date from the source |
| `posting_date` | posting or settlement date from the source |
| `statement_start` | statement period start date |
| `statement_end` | statement period end date |
| `statement_id` | statement identifier or label |

When both `transaction_date` and `posting_date` exist:

- `ts` SHOULD still be a stable canonical timestamp for the stored event
- `transaction_date` and `posting_date` MAY both be preserved in `data`
- reports and reconciliations MAY choose different date bases without rewriting the historical fact

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

The schema does not require a single provenance strategy.

For source linkage, operators MAY store:

- a filename or logical document id in `source_doc`
- a row or record reference in `source_row`
- a cryptographic fingerprint in `source_hash`
- a URL, storage key, or external document locator in `source_doc` or another custom `data.*` field
- free-form extraction notes in `provenance`

The canonical recommendation is:

- keep the ledger row small
- store durable references and fingerprints in the ledger
- keep bulky source files outside the ledger itself

### Documents

| Field | Meaning |
|---|---|
| `invoice_id` | stable document identifier |
| `direction` | `issued` or `received` |
| `due_date` | due date for aging/open items |

### Assets

| Field | Meaning |
|---|---|
| `asset_id` | original capitalized event id |
| `impairment_amount` | impairment value |
| `proceeds` | disposal proceeds |

Capitalization judgment SHOULD be stored as a `treatment` event rather than as an inline flag on the purchase row.

### Treatments

Common `treatment` fields:

| Field | Meaning |
|---|---|
| `treatment_id` | stable identifier for the accounting position |
| `treatment_kind` | kind such as `capitalize_asset` or `accrual` |
| `applies_to` | scope anchors such as `event_ids` or `document_ids` |
| `status` | `proposed`, `active`, `superseded`, or `rejected` |
| `effective_from` | start date for applying the treatment |
| `effective_to` | optional end date |
| `position` | treatment-specific structured accounting thesis |
| `justification_summary` | concise durable explanation |
| `compile_strategy` | deterministic downstream compilation bridge |

### FX and lot tracking

Common optional fields:

- `base_amount`
- `fx_rate`
- `base_currency`
- `price_usd`
- `price_source`
- `valuation_ts`
- `lot_id`
- `lot_ref`
- `disposition_lots`

For single-currency reporting, prefer:

- `amount` as the native signed transaction amount
- `currency` as the native transaction currency
- `base_amount` as the explicit signed reporting amount
- `base_currency` as the reporting currency for `base_amount`

`fx_rate` and `price_usd` are valuation facts and audit metadata. They SHOULD NOT be treated as an implicit instruction to derive reporting totals later.

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

### Treatment event

```json
{
  "source": "agent_worker",
  "type": "treatment",
  "data": {
    "treatment_id": "trt_asset_laptop_2026_02",
    "treatment_kind": "capitalize_asset",
    "applies_to": {
      "event_ids": ["evt_laptop_purchase"]
    },
    "status": "active",
    "effective_from": "2026-02-16",
    "recognition_basis": "capitalized",
    "reporting_impact": ["pnl", "balance_sheet", "assets"],
    "position": {
      "asset_class": "computer_equipment",
      "cost_basis": 300,
      "depreciation_method": "straight_line",
      "useful_life_months": 36,
      "in_service_date": "2026-02-16",
      "salvage_value": 0
    },
    "justification_summary": "Computer equipment with multi-period utility; capitalize under current policy.",
    "confidence": "clear",
    "compile_strategy": "asset_schedule"
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
