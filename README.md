# clawbooks

Accounting by inference, not by engine.

Financial memory for agents.

Clawbooks is an append-only ledger, a plain-English accounting policy, and a CLI.
Your agent reads the data, reads the policy, and does the accounting.

No rules engine. No SDK. No framework.

**Two source files. Zero runtime dependencies.**

## Why

Most accounting software assumes the product should contain the accounting logic.
Clawbooks takes the opposite view:

- the ledger stores facts
- the policy states the rules in plain English
- the agent does the reasoning

That makes clawbooks useful anywhere an agent can read files and run shell commands.

## What you get

- Append-only JSONL ledger with hash chaining
- Plain-English policy file instead of embedded bookkeeping logic
- CLI commands for recording, reviewing, reconciling, compacting, and packaging records
- Structured `context` output designed for agent reasoning
- Zero runtime dependencies

## Example

```text
You: "What's my P&L for March?"

Agent runs:    clawbooks context 2026-03
Agent reads:   policy + snapshot + events
Agent reasons: applies the policy to the records
Agent replies: "Revenue: $1,700. Expenses: $475. Net: $1,225."
```

There is no accounting engine. In clawbooks, the agent is the engine.

## Install

```bash
npm install -g clawbooks
clawbooks --help
cp policy.md.example policy.md
```

## Local setup

```bash
git clone https://github.com/rev1ck/clawbooks.git
cd clawbooks
npm install
npm run build
cp policy.md.example policy.md   # edit with your own accounting rules
```

## How it works

Clawbooks stores financial events and outputs accounting context.
The important command is `clawbooks context`: it prints your policy, the latest snapshot, and the relevant events in XML-style blocks so an agent can read and reason over them.

## Commands

```bash
# Write events
clawbooks record '{"source":"stripe","type":"payment","data":{"amount":500,"currency":"USD"}}'
cat events.jsonl | clawbooks batch

# Read events
clawbooks log --last 10
clawbooks log --source stripe --after 2026-03-01
clawbooks stats

# Load context for the agent
clawbooks context 2026-03
clawbooks context --after 2026-01-01

# Analysis
clawbooks verify 2026-03                            # integrity + chain + duplicates
clawbooks verify --balance 50000 --currency USD     # cross-check closing balance
clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --gaps
clawbooks review --source bank                      # items needing classification
clawbooks summary 2026-03                           # aggregates for reports
clawbooks snapshot 2026-03 --save                   # persist period snapshot
clawbooks assets --as-of 2026-03-31                 # asset register + depreciation

# Maintenance
clawbooks compact 2025-12                           # archive old events, shrink ledger
clawbooks pack 2026-03 --out ./march-pack           # generate audit pack (CSVs + JSON)

# Print the policy
clawbooks policy
```

## The context command

This is the core command. It prints your accounting policy, the latest snapshot, and the events for a period, wrapped in XML tags so the agent can read and reason over them.

```bash
$ clawbooks context 2026-03

<policy>
# Accounting policy
Cash basis. Crypto trades are revenue income...
</policy>

<snapshot as_of="2026-03-01">
{"balances":{"USDC":45000},"ytd_pnl":18450}
</snapshot>

<events count="47" after="2026-03-01" before="2026-03-31">
{"ts":"...","source":"stripe","type":"payment","data":{"amount":500,...}}
{"ts":"...","source":"bank","type":"fee","data":{"amount":-55,...}}
...
</events>
```

## Importing data

There is no import command. The agent is the importer.

```text
You: [paste CSV] "Import this bank statement"

Agent: reads the CSV
       reads policy via `clawbooks policy`
       classifies each row per the policy
       outputs JSONL and pipes it to `clawbooks batch`

Agent: "Recorded 47 events from Chase March statement."
```

## Asset tracking

Mark purchases for capitalization with `data.capitalize: true`:

```bash
clawbooks record '{"source":"bank","type":"expense","data":{"amount":15000,"currency":"USD","description":"MacBook Pro","category":"hardware","capitalize":true,"useful_life_months":36}}'
```

Then track depreciation, disposals, write-offs, and impairments:

```bash
clawbooks assets --as-of 2026-03-31
clawbooks record '{"source":"manual","type":"disposal","data":{"asset_id":"<id>","proceeds":5000,"currency":"USD"}}'
```

## Scaling

When the ledger grows large, compact old periods into an archive:

```bash
clawbooks compact 2025-12
# -> archives old events to ledger-archive-2025-12-31.jsonl
# -> rewrites the main ledger as: 1 snapshot + newer events
```

The archive remains a complete hash-chained ledger for audits. The main ledger stays small enough for agent context windows.

## Audit packs

Generate a folder of standard-format files for accountants or auditors:

```bash
clawbooks pack 2026-01/2026-12-31 --out ./annual-pack
```

This produces `general_ledger.csv`, `summary.json`, `asset_register.csv`, `reclassifications.csv`, `verify.json`, and a copy of `policy.md`.
The output is assistive. It gives an accountant structured working material, not a pretend finished report.

## Agent setup

Point your agent at `program.md` for instructions on how to use clawbooks.

- **Claude Code**: add `Read program.md in the clawbooks directory for financial record-keeping instructions.`
- **Codex**: add the same pointer in `AGENTS.md` or your system prompt
- **Any shell-capable agent**: clawbooks prints structured text for the agent to read and reason over

The npm package includes `program.md` and the policy examples, so this workflow also works from a global install.

## Packaging

The primary package should stay `clawbooks` for the clean install path.
If you later want a brand-owned scoped companion package, the repo can stage `@clawbooks/cli` without renaming the live package:

```bash
npm run scoped:prepare
npm run scoped:pack:dry-run
```

This writes a temporary scoped package into `.dist/scoped-cli` for inspection or future publish work.

## Files

```text
cli.ts                  CLI commands
ledger.ts               JSONL read/write/filter
program.md              Agent instructions
policy.md               Your accounting rules (you write this, gitignored)
policy.md.example       Example policy to start from
ledger.jsonl            Your financial events (append-only, gitignored)
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBOOKS_LEDGER` | `./ledger.jsonl` | Path to ledger |
| `CLAWBOOKS_POLICY` | `./policy.md` | Path to policy |

No API key needed. Bring your own agent.

## License

MIT
