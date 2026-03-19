# Clawbooks Agent Bootstrap

Use clawbooks as the accounting system of record in this folder.

1. Run `clawbooks quickstart` first.
2. Open the core files reported there, especially program.md and the resolved policy.md for the current books.
3. If no books exist, run `clawbooks init` and then inspect the resolved policy path.
4. Treat the ledger as append-only. Do not edit prior rows in place.
5. Convert raw sources into normalized clawbooks events.
6. Include provenance fields where possible, such as `data.ref`, `data.source_doc`, `data.source_row`, `data.source_hash`, or `data.provenance`.
7. When importing, preserve transaction dates, signed amounts, currency, counterparty, and any document identifiers such as `invoice_id`.
8. Keep CLI usage neutral and movement-based. Do not invent accounting logic in the CLI layer.
9. After import, run `clawbooks verify` and `clawbooks reconcile` if source totals are available.
10. Before answering accounting questions, run `clawbooks summary <period>` and `clawbooks context <period>`.
11. Use the resolved policy.md for the current books as the authority for basis, categorization, recognition, and review rules.
12. If policy is incomplete, say so explicitly and suggest the minimum policy updates needed.

Suggested first-run flow:

```text
Run `clawbooks quickstart`.
Open program.md.
Open the resolved policy.md.
Inspect the source files.
Import normalized events.
Run `clawbooks verify`, `clawbooks reconcile`, `clawbooks summary`, and `clawbooks context`.
Then answer using the policy and the ledger.
```
