# Clawbooks Reporting Artifact Spec

Status: draft

Version: 0.1

## 1. Purpose

This spec defines the reporting artifact emitted by a finalized Clawbooks reporting run.

The artifact exists to support:

- drill-down from reported rows to source support
- auditor review and sign-off
- rerun stability and diffability
- host UX integration without hardcoding report-family-specific logic

The artifact is a derived record of one finalized inference run.

It is not a replacement for:

- `ledger.jsonl`
- `policy.md`
- `program.md`
- inference-time accounting by the agent

## 2. Core Thesis

Clawbooks keeps the same thesis:

- `ledger.jsonl` stores facts and durable treatments
- `policy.md` stores entity-level accounting rules
- `program.md` stores operator and agent behavior
- the agent does the accounting at inference time

This spec does not introduce:

- a deterministic accounting engine
- a reporting DSL
- a rules engine for niche cases
- a requirement to persist report rows in the ledger
- a requirement to store model chain-of-thought

The artifact records the final support contract for a report, not the model's private reasoning trace.

## 3. Scope

This spec applies to finalized reporting outputs including:

- income statement / P&L
- balance sheet
- cash flow
- debtors and creditors aging
- tax-oriented cuts
- asset register views
- reconciliations and investigation reports
- custom policy-grounded reporting slices

The design must remain generic across report families.

The UI is out of scope.

The artifact must be designed so a separate UI, API, export pipeline, or audit workflow can consume it directly.

## 4. Non-Goals

This spec does not define:

- a closed grammar for all possible accounting reports
- a universal evidence storage format
- full model reasoning capture
- storage of intermediate prompts or scratchpads
- automatic accounting decisions outside the agent's inference loop

## 5. Reporting Run Model

A finalized reporting run has four conceptual stages:

1. Inputs
   - ledger facts
   - durable treatments
   - policy
   - program
   - report request

2. Inference
   - the agent reasons over those inputs
   - the agent decides the report structure and accounting interpretation for the requested view

3. Finalized output
   - human-facing report output
   - structured reporting artifact

4. Post-processing
   - deterministic validation
   - deterministic fingerprinting
   - optional packaging for export or audit

The structured artifact is a record of stage 3, with additional deterministic metadata from stage 4.

## 6. Key Principle: Support Contract, Not Thought Trace

The artifact must capture the support for the final answer.

It must not attempt to store the full reasoning process that produced the answer.

### 6.1 What the artifact should capture

- report rows
- row totals and dimensions
- contributor rollups
- anchors to supporting facts, documents, treatments, and snapshots
- policy and program versions used
- exceptions, unresolved issues, and validation results

### 6.2 What the artifact should not capture

- chain-of-thought
- hidden deliberation
- every intermediate draft row
- verbose natural-language scratch notes
- token-heavy reasoning transcripts

Auditors and users generally need supportability, not the model's private notebook.

## 7. Architectural Split

### 7.1 Truth layer

Canonical truth remains:

- `ledger.jsonl`
- `policy.md`
- `program.md`
- source evidence referenced by ledger events

### 7.2 Inference layer

The agent:

- reads truth inputs
- interprets the report request
- assembles the requested accounting view
- emits a compact structured artifact alongside the human-facing answer

### 7.3 Deterministic packaging layer

Code may:

- validate artifact shape
- compute fingerprints
- normalize field order
- verify arithmetic invariants
- attach workflow and environment metadata
- package the artifact with companion files

Code must not become the accounting engine.

## 8. Required Outputs For a Finalized Report Run

A finalized run should emit at least:

- `report.md` or equivalent human-facing output
- `artifact.json`

An audit-oriented pack may additionally include:

- `verify.json`
- `workflow.json`
- `general_ledger.csv`
- `treatments.csv`
- `corrections.csv`
- `confirmations.csv`
- `policy.md`
- `program.md`
- family-specific schedules where relevant

## 9. Artifact Design Goals

The artifact must be:

- generic
- compact
- stable across reruns when inputs are unchanged
- explicit about uncertainty
- drill-down friendly
- consumable by non-CLI hosts

The artifact should favor:

- IDs over embedded payload duplication
- hashes over repeated large text blocks
- contributor references over copied event bodies
- short exception codes over long prose

## 10. Core Artifact Model

The artifact has four main reporting objects:

1. View
   One requested report surface such as `income_statement` or `receivables_aging`

2. Row
   One line item presented to the user

3. Contributor
   One compact support block that explains part or all of a row amount

4. Anchor
   One immutable reference to ledger facts, treatments, documents, snapshots, or evidence locators

This split is the core of generic drill-down.

### 10.1 View

A view groups rows and carries report-family-specific dimensions.

Examples:

- `income_statement`
- `balance_sheet`
- `cash_flow`
- `receivables_aging`
- `asset_register`
- `custom`

### 10.2 Row

A row is what the UI shows first.

Examples:

- `hosting`
- `trade_receivables_31_60`
- `computer_equipment`
- `vat_payable`
- `custom_counterparty_cut`

### 10.3 Contributor

A contributor explains how a row is supported.

It is not required to be one ledger event.

A contributor may represent:

- a direct set of events
- an open document balance
- a treatment-derived compiled entry
- a snapshot carry-forward
- a supporting schedule rollup

### 10.4 Anchor

An anchor points to the durable support behind the contributor.

Examples:

- ledger event id
- treatment id
- snapshot id
- invoice id
- `data.ref`
- `data.source_doc`
- `data.source_row`
- `data.source_hash`

## 11. Canonical Top-Level Shape

`artifact.json` should use this high-level shape:

```json
{
  "meta": {},
  "request": {},
  "views": [],
  "checks": [],
  "exceptions": [],
  "fingerprints": {}
}
```

Exact field naming may evolve, but the concepts are required.

## 12. `meta`

`meta` identifies the run and its accounting context.

Recommended fields:

- `artifact_id`
- `artifact_version`
- `generated_at`
- `status`
- `reporting_mode`
- `classification_basis`
- `entity_id` when known
- `period`
- `as_of` when relevant
- `base_currency` when requested
- `generator`
- `workflow_state`

`status` should be one of:

- `finalized`
- `provisional`

If a run is not policy-grounded, the artifact may still exist, but it must be explicitly marked provisional.

## 13. `request`

`request` records what the run was asked to produce.

Recommended fields:

- `prompt`
- `report_family`
- `requested_views`
- `filters`
- `materiality_threshold` when used
- `date_basis` when relevant
- `base_currency`

This is important for rerun comparability.

## 14. `views`

Each view is a compact report surface.

Recommended fields:

- `view_id`
- `kind`
- `title`
- `dimensions`
- `totals`
- `rows`

### 14.1 `kind`

`kind` should identify the semantic report family.

Examples:

- `income_statement`
- `balance_sheet`
- `receivables_aging`
- `asset_register`
- `custom`

### 14.2 `dimensions`

A view may carry dimensions such as:

- period
- as-of date
- counterparty
- account
- category
- aging bucket definition
- currency basis

These dimensions should be explicit instead of implied by prose.

## 15. `rows`

Each row should be a first-class object.

Recommended fields:

- `row_id`
- `row_key`
- `label`
- `amount`
- `currency`
- `display_order`
- `row_kind`
- `dimensions`
- `contributors`
- `status`
- `confidence`
- `notes`

### 15.1 `row_id`

`row_id` should be deterministic for the same report structure and dimensional key.

It should remain stable across reruns when the same row concept is present.

### 15.2 `row_key`

`row_key` is the semantic identity of the row.

Examples:

- `operating_expenses:hosting`
- `receivables_aging:31_60`
- `asset_register:asset:asset_123`
- `custom:counterparty:acme`

### 15.3 `row_kind`

Suggested row kinds:

- `aggregate`
- `leaf`
- `subtotal`
- `total`
- `schedule_line`

### 15.4 `status`

Suggested row statuses:

- `final`
- `provisional`
- `warning`
- `unsupported`

### 15.5 `confidence`

Suggested row confidence values:

- `clear`
- `mixed`
- `inferred`
- `unclear`

Row confidence should summarize the quality of support, not the confidence of the model in general.

## 16. `contributors`

Each row should list one or more contributors.

The row total must be explainable as the sum of contributor amounts.

Recommended contributor fields:

- `contributor_id`
- `kind`
- `amount`
- `currency`
- `anchors`
- `derived_from`
- `support_summary`
- `exception_refs`

### 16.1 Contributor kinds

Suggested canonical contributor kinds:

- `direct_events`
- `document_balance`
- `treatment_compile`
- `snapshot_carryforward`
- `schedule_rollup`
- `manual_support_note`

These are reporting support types, not new ledger event types.

### 16.2 `direct_events`

Use when the row is supported directly by ledger events.

Typical anchors:

- event ids
- source refs
- source docs

### 16.3 `document_balance`

Use when the row depends on document settlement state, such as aging.

Typical anchors:

- document event ids
- settlement event ids
- invoice ids
- due dates

### 16.4 `treatment_compile`

Use when the row includes deterministic treatment-derived entries such as accruals or deferred revenue recognition.

Typical anchors:

- treatment id
- anchor event ids
- compiled entry id

### 16.5 `snapshot_carryforward`

Use when a view starts from a snapshot and applies later events.

Typical anchors:

- snapshot id
- snapshot timestamp
- snapshot event count

### 16.6 `schedule_rollup`

Use when the row is best supported through an intermediate schedule, for example:

- an asset register subtotal
- a debtors aging bucket
- a tax schedule cut

The schedule itself may also be represented as rows in another view.

## 17. `anchors`

Anchors are the bridge from the artifact to durable support.

Recommended anchor shape:

- `anchor_type`
- `id`
- `ref`
- `locator`
- `hash`

`anchor_type` may be:

- `event`
- `treatment`
- `snapshot`
- `document`
- `evidence`

### 17.1 Event anchors

Minimum:

- event id

Recommended extras:

- `data.ref`
- `data.source_doc`
- `data.source_row`
- `data.source_hash`

### 17.2 Treatment anchors

Minimum:

- treatment id
- treatment kind

Recommended extras:

- applies-to summary
- effective range
- compile strategy

### 17.3 Evidence anchors

Evidence anchors should identify the external source without forcing evidence blobs into the artifact.

Examples:

- source document path or id
- row number in a CSV
- page reference in a statement
- upstream object id
- source hash

## 18. Generic Drill-Down Contract

The artifact must make drill-down possible without a UI knowing accounting-specific logic.

The generic drill-down contract is:

1. Start at a row
2. Expand contributors
3. Follow anchors to facts, treatments, documents, snapshots, or evidence locators

This works for:

- income statement category rows
- balance sheet balances
- aging buckets
- asset subtotals
- custom policy-defined analytical cuts

## 19. Report-Family Examples

### 19.1 Income statement

Row:

- `operating_expenses:hosting`

Contributors:

- direct event group for hosting expenses
- treatment-derived accrual for an unpaid hosting bill

Anchors:

- expense event ids
- bill event id
- accrual treatment id

### 19.2 Debtors aging

Row:

- `receivables_aging:31_60`

Contributors:

- outstanding balance of open invoices whose days past due fall between 31 and 60

Anchors:

- invoice event ids
- settlement event ids
- invoice ids

### 19.3 Asset register

Row:

- `asset_register:asset:laptop_2025_001`

Contributors:

- capitalized purchase fact
- impairment adjustment when relevant
- disposal support when relevant

Anchors:

- purchase event id
- capitalization treatment id
- impairment event id
- disposal event id

## 20. Audit Requirements

The artifact should let an auditor answer:

- what exactly was reported
- which truth inputs governed the run
- what support exists for each row
- where durable accounting judgment was applied
- whether unresolved issues remained
- whether the run was provisional or policy-grounded

### 20.1 Required audit metadata

Recommended audit metadata:

- `policy_hash`
- `program_hash`
- ledger fingerprint
- included event count
- chain head hash or equivalent ledger chain reference
- active treatment selection
- workflow state
- generated timestamp

### 20.2 Required audit exceptions

Suggested exception codes:

- `provisional_report`
- `missing_evidence`
- `low_confidence_support`
- `partial_fx_coverage`
- `row_invariant_mismatch`
- `unresolved_review_item`
- `duplicate_risk`

Exceptions should be compact, structured, and machine-readable.

## 21. Rerun Stability

Rerun stability means the same truth inputs and operating context should produce:

- the same row identities
- the same contributor identities
- the same totals
- the same fingerprints

when nothing materially changed.

### 21.1 Stability depends on more than ledger events

The following must influence rerun fingerprints:

- included ledger events
- active treatments
- `policy.md`
- `program.md`
- requested report family
- filters and dimensions
- base currency and FX mode
- snapshot usage
- artifact schema version

Hashing event ids alone is not sufficient.

### 21.2 Recommended fingerprints

Recommended fingerprint fields:

- `ledger_chain_head_hash`
- `included_event_ids_hash`
- `policy_hash`
- `program_hash`
- `treatment_selection_hash`
- `request_hash`
- `artifact_hash`

### 21.3 Diff behavior

Future diffing should compare:

- metadata and fingerprints
- view presence
- row ids and row amounts
- contributor sets
- exceptions and checks

## 22. Validation Rules

Validation should remain lightweight and deterministic.

### 22.1 Validator responsibilities

A validator may check:

- artifact schema shape
- required metadata presence
- row totals equal contributor totals
- referenced anchors are syntactically valid
- fingerprint fields exist
- exception codes are known
- provisional status is explicit when workflow is not policy-grounded

### 22.2 Validator non-responsibilities

A validator must not:

- replace the agent's accounting judgment
- decide novel accounting outcomes
- invent missing support
- silently coerce a provisional report into final status

## 23. LLM Output Contract

The LLM should not be asked for raw reasoning traces.

It should be asked for a compact structured support artifact.

### 23.1 The LLM should produce

- requested views
- rows
- row labels and dimensions
- contributor groupings
- anchor references
- short structured notes on unresolved issues

### 23.2 Deterministic code should produce

- hashes
- fingerprints
- workflow metadata
- arithmetic validation results
- normalization of field order
- package file layout

This keeps the accounting with the agent while keeping stability and integrity checks in code.

## 24. Minimum Provenance Expectations For Ledger Events

This spec does not require new top-level ledger fields.

It does require stronger practical expectations for reporting-quality provenance in `data.*`.

For reporting-quality imports, events should include as available:

- `data.ref`
- `data.source_doc`
- `data.source_row`
- `data.source_hash`
- `data.counterparty`
- `data.invoice_id`
- `data.transaction_date`
- `data.posting_date`

Without stable provenance locators in events, downstream drill-down quality will be limited.

## 25. Relationship To Existing Clawbooks Surfaces

### 25.1 `summary`

`summary` remains the orientation surface.

It should not be forced to become the canonical reporting artifact.

### 25.2 `context`

`context` remains the investigation surface.

It may help inspect event-level detail, but it is not the finalized artifact contract.

### 25.3 `documents`

`documents` remains the operational view for receivables, payables, and aging logic.

Its outputs should be reusable as contributors or schedules within the artifact.

### 25.4 `assets`

`assets` remains the operational asset register builder.

Its outputs should be reusable as rows or schedules within the artifact.

### 25.5 `pack`

`pack` should be the first canonical emitter of `artifact.json`.

Reason:

- it is already export-oriented
- it already enforces workflow guardrails
- it naturally owns packaging of companion files

## 26. Packaging Recommendation

The recommended first implementation is:

- `pack` emits `artifact.json`
- existing companion files remain
- `artifact.json` becomes the canonical machine-readable record of the finalized report

Suggested pack contents:

- `artifact.json`
- `report.md`
- `summary.json`
- `verify.json`
- `workflow.json`
- `general_ledger.csv`
- optional schedules and treatment exports
- `policy.md`
- `program.md`

## 27. Minimal Example

```json
{
  "meta": {
    "artifact_id": "rpt_2026_03_income_statement_001",
    "artifact_version": "0.1",
    "status": "finalized",
    "reporting_mode": "policy_grounded",
    "generated_at": "2026-04-04T12:00:00.000Z"
  },
  "request": {
    "report_family": "income_statement",
    "prompt": "generate a pnl for March 2026",
    "filters": {
      "after": "2026-03-01",
      "before": "2026-03-31"
    }
  },
  "views": [
    {
      "view_id": "income_statement",
      "kind": "income_statement",
      "title": "Income Statement",
      "rows": [
        {
          "row_id": "row_hosting",
          "row_key": "operating_expenses:hosting",
          "label": "Hosting",
          "amount": -1250.0,
          "currency": "USD",
          "row_kind": "leaf",
          "status": "final",
          "confidence": "clear",
          "contributors": [
            {
              "contributor_id": "ctr_hosting_events",
              "kind": "direct_events",
              "amount": -950.0,
              "anchors": [
                { "anchor_type": "event", "id": "evt_1" },
                { "anchor_type": "event", "id": "evt_9" }
              ]
            },
            {
              "contributor_id": "ctr_hosting_accrual",
              "kind": "treatment_compile",
              "amount": -300.0,
              "anchors": [
                { "anchor_type": "treatment", "id": "trt_22" },
                { "anchor_type": "event", "id": "evt_44" }
              ]
            }
          ]
        }
      ]
    }
  ],
  "checks": [
    {
      "code": "row_equals_contributors",
      "status": "pass"
    }
  ],
  "exceptions": [],
  "fingerprints": {
    "policy_hash": "sha256:def456",
    "program_hash": "sha256:ghi789",
    "included_event_ids_hash": "sha256:abc123"
  }
}
```

## 28. Rollout

### Phase 1

- define `artifact.json` schema
- emit it from `pack`
- include metadata, rows, contributors, anchors, checks, and fingerprints

### Phase 2

- add validator support
- add artifact diffing
- add reusable schedule sections for aging and asset views

### Phase 3

- expose compact artifact-aware JSON from other surfaces where useful
- add richer host integration guidance for non-CLI adapters

## 29. Recommendation

Clawbooks should adopt the reporting artifact as a compact record of one finalized inference-time report run.

That approach preserves the thesis:

- facts remain in the ledger
- policy remains in `policy.md`
- operating behavior remains in `program.md`
- the agent still performs the accounting

while adding the missing layer needed for:

- generic drill-down
- auditor-ready supportability
- rerun stability
- host UX interoperability

The key design rule is simple:

store the final support map, not the model's entire thought process.
