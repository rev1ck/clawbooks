# Clawbooks Surfaces

Read this file only when you need concrete examples for choosing or using the CLI versus `clawbooks/operations`.

## CLI Pattern

Use the CLI when the host can run shell commands against a real books directory.

Typical sequence:

```bash
clawbooks quickstart
clawbooks where
clawbooks doctor
clawbooks workflow ack --program --policy
clawbooks import check staged.jsonl
clawbooks batch < staged.jsonl
clawbooks verify 2026-03
clawbooks reconcile 2026-03 --source statement_import
clawbooks review 2026-03
clawbooks summary 2026-03
```

Prefer command help for flags instead of memorized examples.

## Embedded Pattern

Use `clawbooks/operations` when Clawbooks is being called from app code, a worker, an OpenClaw adapter, or an Agent SDK-backed UI.

Typical imports:

```ts
import {
  analyzeVerification,
  buildContext,
  buildImportCheck,
  buildReviewQueue,
  buildSummary,
  prepareBatch,
  prepareRecord,
} from "clawbooks/operations";
```

Usage rules:

- pass source data into operations and render or persist the returned result in the adapter
- catch thrown errors in the adapter and convert them into UI or API errors
- do not reproduce Clawbooks business logic in the adapter if an operation already exists
- keep policy-grounded versus provisional status visible in the host experience
