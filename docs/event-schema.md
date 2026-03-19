# Clawbooks Event Schema

This document defines the canonical event envelope for `clawbooks`.

Clawbooks stores append-only ledger events in `ledger.jsonl`. Each line is one JSON object. The ledger is the source of truth. Policy interpretation lives in `policy.md`.

## Event Envelope

Every ledger row uses this envelope:

```json
{
  "ts": "2026-03-15T10:30:00.000Z",
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": -120,
    "currency": "USD",
    "category": "software",
    "description": "Hosting"
  },
  "id": "abc123def4567890",
  "prev": "fedcba0987654321"
}
```

## Top-Level Fields

### `ts`

- ISO-8601 timestamp.
- Optional on input to `clawbooks record`; the CLI will default to now.
- Should preserve the transaction or event time whenever the source provides it.

### `source`

- Required.
- Identifies where the event came from.
- Examples: `bank`, `stripe`, `manual`, `exchange`, `clawbooks:snapshot`.

### `type`

- Required.
- Defines the event class and sign behavior.
- Examples: `income`, `expense`, `invoice`, `snapshot`, `reclassify`.

### `data`

- Required object.
- Holds the financial payload, accounting hints, provenance, and extra source detail.

### `id`

- Deterministic event identifier generated from `source`, `type`, `ts`, and `data`.
- Used for deduplication and append-only correction events.

### `prev`

- Hash-chain pointer to the prior ledger row.
- `genesis` for the first event in a ledger.

## Required `data` Fields

### `data.amount`

- Required for all financial movement events.
- Numeric.
- Stored with sign according to event type and direction.

### `data.currency`

- Required for most event types.
- Exempt event types:
  - `snapshot`
  - `reclassify`
  - `opening_balance`
  - `correction`
  - `confirm`

## Sign Rules

The CLI normalizes sign conventions for known types.

### Outflow types

Stored as negative:

- `expense`
- `tax_payment`
- `owner_draw`
- `fee`
- `dividend`
- `loan_repayment`
- `refund`
- `transfer_out`
- `withdrawal`

### Inflow types

Stored as positive:

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

Sign is derived from `data.direction`:

- `issued` => positive
- `received` => negative

If `data.direction` is absent, sign is not enforced.

### Meta types

Sign not enforced:

- `snapshot`
- `reclassify`
- `opening_balance`
- `correction`
- `confirm`

### Asset lifecycle types

Sign not enforced:

- `disposal`
- `write_off`
- `impairment`

## Core Event Types

### Operating cash events

Examples:

- `income`
- `expense`
- `fee`
- `grant`

Common fields:

- `data.amount`
- `data.currency`
- `data.category`
- `data.description`
- `data.counterparty`
- `data.account`

### Transfer and financing events

Examples:

- `transfer_in`
- `transfer_out`
- `loan_received`
- `loan_repayment`
- `equity_injection`
- `owner_draw`
- `dividend`

Use these to separate operating activity from financing and internal movement.

### Opening balances

Type: `opening_balance`

Use one event per account/currency pair before importing later activity.

Recommended fields:

- `data.amount`
- `data.currency`
- `data.account`
- `data.category`

Convention:

- positive amount => asset
- negative amount => liability

### Document events

Types:

- `invoice`
- `bill`

Recommended fields:

- `data.amount`
- `data.currency`
- `data.direction`
- `data.invoice_id`
- `data.counterparty`
- `data.due_date`
- `data.description`

Use document events for receivables and payables. Match later cash activity by `invoice_id` where possible.

### Snapshot events

Type: `snapshot`

Snapshots are derived checkpoints saved into the ledger with:

- `period`
- `event_count`
- `balances`
- `by_category`
- `movement_summary`
- `report_sections`
- `report_totals`

Snapshots are not the source of truth. They accelerate later reasoning and compacted ledgers.

### Review and correction events

Types:

- `reclassify`
- `correction`
- `confirm`

Recommended fields:

For `reclassify`:

- `data.original_id`
- `data.new_category`

For `correction`:

- `data.original_id`
- `data.reason`
- `data.corrected_fields`

For `confirm`:

- `data.original_id`
- `data.confirmed_by`
- `data.notes`

These events preserve append-only audit history instead of mutating prior ledger rows.

### Asset lifecycle events

Types:

- `disposal`
- `write_off`
- `impairment`

Recommended fields:

- `data.asset_id`
- `data.currency`
- `data.proceeds` for disposals
- `data.impairment_amount` for impairments

Capitalized asset purchases are usually regular expense events with:

- `data.capitalize: true`
- `data.useful_life_months`

## Provenance Fields

Use these whenever you can trace an imported event back to source material:

- `data.ref`
- `data.source_doc`
- `data.source_row`
- `data.source_hash`
- `data.provenance`

## Import Identity Fields

Use these to record which human or system wrote the event:

- `data.recorded_by`
- `data.recorded_via`
- `data.import_session`

## Optional Analytical Fields

These are conventions, not engine rules:

- `data.confidence`
- `data.account`
- `data.base_currency`
- `data.fx_rate`
- `data.price_usd`
- `data.price_source`
- `data.valuation_ts`
- `data.lot_id`
- `data.lot_ref`
- `data.disposition_lots`

## Minimal Examples

### Income

```json
{
  "source": "bank",
  "type": "income",
  "data": {
    "amount": 5000,
    "currency": "USD",
    "category": "consulting",
    "description": "Client payment"
  }
}
```

### Expense

```json
{
  "source": "bank",
  "type": "expense",
  "data": {
    "amount": 125,
    "currency": "USD",
    "category": "software",
    "description": "Subscription"
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
    "counterparty": "acme",
    "due_date": "2026-04-15"
  }
}
```

### Reclassification

```json
{
  "source": "manual",
  "type": "reclassify",
  "data": {
    "original_id": "abc123def4567890",
    "new_category": "contractor"
  }
}
```

## Practical Rule

Store facts in the ledger, store interpretation rules in `policy.md`, and use append-only follow-up events for review and correction.
