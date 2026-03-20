# Statement Import Example

This is the intended clawbooks path for a statement-style CSV:

1. Create books and inspect the workflow:

```bash
clawbooks init
clawbooks quickstart
```

2. Generate the statement scaffold:

```bash
clawbooks import scaffold statement-csv
```

This creates:

- `mapper.mjs`
- `mapper.py`
- `statement-profile.json`
- `vendor-mappings.json`

`vendor-mappings.json` is optional. It stores recurring description hints that the mapper may consult. It does not replace `policy.md`.

3. Edit the mapper to match the source columns.

The default statement scaffold is shaped for common fields:

- `transaction_date`
- `posting_date`
- `description`
- `debit`
- `credit`
- `balance`

4. Emit staged JSONL:

```bash
node .books/imports/statement-csv/mapper.mjs statement.csv > staged.jsonl
```

or

```bash
python3 .books/imports/statement-csv/mapper.py statement.csv > staged.jsonl
```

5. Validate the staged file before append:

```bash
clawbooks import check staged.jsonl --statement .books/imports/statement-csv/statement-profile.json --save-session
```

This checks:

- row count
- debits and credits
- opening and closing balance
- date-basis coverage
- provenance coverage
- duplicate refs
- scoped ordering
- mapping coverage and consistency signals when `vendor-mappings.json` is present

When `--save-session` is used inside a books workspace, clawbooks writes the validation sidecar under `.books/imports/sessions/`.

Optional maintenance commands:

```bash
clawbooks import mappings suggest --source statement_import
clawbooks import mappings check staged.jsonl --mappings .books/imports/statement-csv/vendor-mappings.json
```

6. Append only after the staged file passes:

```bash
clawbooks batch < staged.jsonl
clawbooks verify 2026-03 --balance 900 --opening-balance 1000 --currency USD
clawbooks reconcile 2026-03 --source statement_import --count 2 --debits -300 --credits 200 --opening-balance 1000 --closing-balance 900 --date-basis posting
clawbooks review 2026-03
```

7. If needed, generate bulk review actions:

```bash
clawbooks review batch 2026-03 --out review-actions.jsonl --action confirm --confidence inferred
clawbooks batch < review-actions.jsonl
```

Notes:

- Prefer importing full source coverage when practical.
- Cut reporting periods later at reporting time.
- Keep reusable merchant hints in `vendor-mappings.json`, not in opaque code branches.
