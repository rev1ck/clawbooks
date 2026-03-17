# clawbooks

Accounting by inference, not by engine.

An append-only ledger + plain english policy + CLI.
Your LLM agent reads the data, reads the policy, does the accounting.
No rules engine. No SDK. No framework.

**Two source files. Zero runtime dependencies.**

## Setup

```bash
git clone https://github.com/yourname/clawbooks.git
cd clawbooks
npm install
npm run build
cp policy.md.example policy.md   # edit with your own accounting rules
```

## How it works

Clawbooks stores financial events and outputs context. The LLM you're already talking to does the accounting.

```
You: "What's my P&L for March?"

Agent runs:    clawbooks context 2026-03
Agent reads:   policy + events
Agent thinks:  *applies policy to events*
Agent responds: "Revenue: $1,700. Expenses: $475. Net: $1,225."
```

There is no accounting engine. The LLM *is* the engine.

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
clawbooks verify 2026-03                          # integrity + chain + duplicates
clawbooks verify --balance 50000 --currency USD    # cross-check closing balance
clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --gaps
clawbooks review --source bank                     # items needing classification
clawbooks summary 2026-03                          # aggregates for reports
clawbooks snapshot 2026-03 --save                  # persist period snapshot
clawbooks assets --as-of 2026-03-31                # asset register + depreciation

# Print the policy
clawbooks policy
```

## The context command

This is the important one. It outputs your accounting policy + the latest snapshot + all events in a period, wrapped in XML tags. The agent reads this output and reasons over it.

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

There is no import command. Your agent IS the importer.

```
You: [paste CSV] "Import this bank statement"

Agent: *reads CSV, reads policy via `clawbooks policy`*
       *classifies each row per the policy*
       *outputs JSONL, pipes to `clawbooks batch`*

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

## Agent setup

Point your agent at `program.md` for instructions on how to use clawbooks. For example:

- **Claude Code** — add to your `CLAUDE.md`: `Read program.md in the clawbooks directory for financial record-keeping instructions.`
- **Codex** — add to your `AGENTS.md` or system prompt with the same pointer
- **Any agent** — any agent that can shell out can use clawbooks. The CLI outputs structured text. The agent reads it and reasons.

## Files

```
cli.ts                  CLI commands
ledger.ts               JSONL read/write/filter
program.md              Agent instructions (how to use clawbooks)
policy.md               Your accounting rules (you write this, gitignored)
policy.md.example       Example policy to start from
ledger.jsonl            Your financial events (append-only, gitignored)
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBOOKS_LEDGER` | `./ledger.jsonl` | Path to ledger |
| `CLAWBOOKS_POLICY` | `./policy.md` | Path to policy |

No API key needed. The agent brings its own LLM.

## License

MIT
