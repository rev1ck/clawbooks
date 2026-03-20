import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { positional, flags } from "../cli-helpers.js";
import { round2, sortByTimestamp } from "../reporting.js";
import { filterByDateBasis, type DateBasis } from "../imports.js";
import type { LedgerEvent } from "../ledger.js";

type ImportParams = {
  booksDir: string | null;
};

type ScaffoldKind = "statement-csv" | "generic-csv" | "fills-csv" | "manual-batch";
type StatementProfile = {
  statement_id?: string;
  source?: string;
  currency?: string;
  date_basis?: DateBasis;
  statement_start?: string;
  statement_end?: string;
  opening_balance?: number;
  closing_balance?: number;
  count?: number;
  debits?: number;
  credits?: number;
  newest_first?: boolean;
};

const VALID_KINDS: ScaffoldKind[] = ["statement-csv", "generic-csv", "fills-csv", "manual-batch"];

function readEventsFile(path: string): LedgerEvent[] {
  if (!existsSync(path)) {
    console.error(`No file found at ${path}`);
    process.exit(1);
  }
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    console.error(`Failed to parse JSONL events from ${path}`);
    process.exit(1);
  }
}

function readStatementProfile(path: string): StatementProfile {
  if (!existsSync(path)) {
    console.error(`No statement profile found at ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    console.error(`Failed to parse statement profile JSON from ${path}`);
    process.exit(1);
  }
}

function sumBySign(events: LedgerEvent[]): { debits: number; credits: number; net: number } {
  let debits = 0;
  let credits = 0;
  let net = 0;
  for (const event of events) {
    const amount = Number(event.data.amount);
    if (!Number.isFinite(amount)) continue;
    net = round2(net + amount);
    if (amount < 0) debits = round2(debits + amount);
    else credits = round2(credits + amount);
  }
  return { debits, credits, net };
}

function eventCountsByType(events: LedgerEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    out[event.type] = (out[event.type] ?? 0) + 1;
  }
  return out;
}

function provenanceCoverage(events: LedgerEvent[]) {
  const counters = {
    source_doc: 0,
    source_row: 0,
    source_hash: 0,
    provenance: 0,
    ref: 0,
  };
  for (const event of events) {
    if (event.data.source_doc !== undefined) counters.source_doc++;
    if (event.data.source_row !== undefined) counters.source_row++;
    if (event.data.source_hash !== undefined) counters.source_hash++;
    if (event.data.provenance !== undefined) counters.provenance++;
    if (event.data.ref !== undefined) counters.ref++;
  }
  return {
    total: events.length,
    fields: Object.fromEntries(Object.entries(counters).map(([key, count]) => [key, {
      count,
      missing: events.length - count,
    }])),
  };
}

function dateCoverage(events: LedgerEvent[]) {
  let transactionDate = 0;
  let postingDate = 0;
  for (const event of events) {
    if (typeof event.data.transaction_date === "string" && event.data.transaction_date) transactionDate++;
    if (typeof event.data.posting_date === "string" && event.data.posting_date) postingDate++;
  }
  return {
    total: events.length,
    transaction_date: {
      count: transactionDate,
      missing: events.length - transactionDate,
    },
    posting_date: {
      count: postingDate,
      missing: events.length - postingDate,
    },
  };
}

function orderingProfile(events: LedgerEvent[], basis: DateBasis) {
  const values = events
    .map((event) => {
      if (basis === "ledger") return event.ts;
      const value = basis === "transaction" ? event.data.transaction_date : event.data.posting_date;
      return typeof value === "string" ? value : null;
    })
    .filter((value): value is string => Boolean(value));
  let asc = true;
  let desc = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) asc = false;
    if (values[i] > values[i - 1]) desc = false;
  }
  return {
    basis,
    order: asc ? "ascending" : desc ? "descending" : "mixed",
    event_count_with_basis: values.length,
  } as const;
}

function duplicateRefs(events: LedgerEvent[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const event of events) {
    const ref = typeof event.data.ref === "string" ? event.data.ref : null;
    if (!ref) continue;
    if (seen.has(ref)) duplicates.add(ref);
    seen.add(ref);
  }
  return [...duplicates].sort();
}

function statementProfileTemplate(): string {
  return JSON.stringify({
    statement_id: "replace-with-statement-id",
    source: "statement_import",
    currency: "USD",
    date_basis: "posting",
    statement_start: "2026-03-01",
    statement_end: "2026-03-31",
    opening_balance: 1000,
    closing_balance: 900,
    count: 2,
    debits: -300,
    credits: 200,
    newest_first: true,
  }, null, 2) + "\n";
}

function dateRange(events: LedgerEvent[], basis: DateBasis): { first: string | null; last: string | null } {
  const dated = events
    .map((event) => {
      if (basis === "ledger") return event.ts;
      const value = basis === "transaction" ? event.data.transaction_date : event.data.posting_date;
      return typeof value === "string" ? value : null;
    })
    .filter((value): value is string => Boolean(value))
    .sort();
  return { first: dated[0] ?? null, last: dated[dated.length - 1] ?? null };
}

function defaultOutDir(kind: ScaffoldKind, booksDir: string | null): string {
  if (booksDir && existsSync(booksDir)) return resolve(booksDir, "imports", kind);
  return resolve("clawbooks-imports", kind);
}

function scaffoldReadme(kind: ScaffoldKind): string {
  const common = [
    "# Import scaffold",
    "",
    `Scaffold kind: \`${kind}\``,
    "",
    "This scaffold is a starting point for user- or agent-authored import logic.",
    "It is intentionally shape-based rather than institution-specific.",
    "",
    "## Output contract",
    "",
    "Emit canonical clawbooks events as JSONL with fields:",
    "",
    "- `ts`",
    "- `source`",
    "- `type`",
    "- `data`",
    "- `id`",
    "- `prev`",
    "",
    "Use clawbooks to compute `id` and `prev` when appending. The mapper should focus on stable `ts`, `source`, `type`, and `data`.",
    "",
    "## Provenance expectations",
    "",
    "Preserve as many of these as the source allows:",
    "",
    "- `data.ref`",
    "- `data.source_doc`",
    "- `data.source_row`",
    "- `data.source_hash`",
    "- `data.provenance`",
    "- `data.recorded_by` or `data.import_session`",
    "",
    "## Workflow",
    "",
    "1. Inspect the source and decide which dates matter.",
    "2. Normalize rows into canonical events using either `mapper.mjs` or `mapper.py`.",
    "3. Preserve provenance and source-specific facts in `data`.",
    "4. Review the emitted JSONL before appending.",
    "5. Use `clawbooks batch`, `clawbooks verify`, `clawbooks reconcile`, and `clawbooks review` after import.",
    "",
  ];

  const byKind: Record<ScaffoldKind, string[]> = {
    "statement-csv": [
      "## Statement-specific checklist",
      "",
      "- Decide whether reporting and reconciliation should use `transaction_date`, `posting_date`, or ledger `ts`.",
      "- Record statement period, opening balance, and closing balance when available.",
      "- Handle newest-first exports explicitly before emitting events.",
      "- Check row count, debit total, and credit total against the source statement.",
      "",
    ],
    "generic-csv": [
      "## Generic export checklist",
      "",
      "- Identify which columns are stable identifiers versus display text.",
      "- Preserve source categories and descriptions even if policy later reinterprets them.",
      "- Keep import-specific assumptions in code comments or in the policy if they affect reporting.",
      "",
    ],
    "fills-csv": [
      "## Trade or fills checklist",
      "",
      "- Preserve trade-side, quantity, unit price, fees, venue, and settlement currency.",
      "- Keep raw execution facts separate from later reporting interpretations.",
      "- Capture identifiers that help match fills to transfers, settlements, or lot-tracking policy.",
      "",
    ],
    "manual-batch": [
      "## Manual batch checklist",
      "",
      "- Use this when source material is ad hoc and a custom parser is unnecessary.",
      "- Prefer one JSON object per event with explicit provenance notes.",
      "- Keep the batch file small and reviewable before appending.",
      "",
    ],
  };

  return [...common, ...byKind[kind]].join("\n");
}

function scaffoldMapper(kind: ScaffoldKind): string {
  const sharedHelpers = `import { readFileSync } from "node:fs";

function csvRows(path) {
  const text = readFileSync(path, "utf-8").trim();
  if (!text) return [];
  const [headerLine, ...lines] = text.split(/\\r?\\n/);
  const headers = headerLine.split(",").map((cell) => cell.trim());
  return lines
    .filter(Boolean)
    .map((line, index) => {
      const cells = line.split(",");
      const row = Object.fromEntries(headers.map((header, i) => [header, (cells[i] ?? "").trim()]));
      row.__row = String(index + 2);
      return row;
    });
}

function isoDate(value) {
  if (!value) return null;
  if (value.includes("T")) return value;
  return \`\${value}T00:00:00.000Z\`;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
`;

  const templates: Record<ScaffoldKind, string> = {
    "statement-csv": `${sharedHelpers}
const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node mapper.mjs <statement.csv>");
  process.exit(1);
}

const rows = csvRows(inputPath);
const events = rows
  .slice()
  .reverse()
  .map((row) => {
    const amount = numberOrNull(row.amount);
    if (amount === null) return null;
    return {
      ts: isoDate(row.posting_date || row.transaction_date),
      source: "statement_import",
      type: amount >= 0 ? "income" : "expense",
      data: {
        amount,
        currency: row.currency || "USD",
        description: row.description || row.memo || "",
        category: "uncategorized",
        confidence: "inferred",
        transaction_date: row.transaction_date || null,
        posting_date: row.posting_date || null,
        source_doc: inputPath,
        source_row: row.__row,
        provenance: {
          import_kind: "statement-csv",
          row_snapshot: row,
        },
      },
    };
  })
  .filter(Boolean);

for (const event of events) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}
`,
    "generic-csv": `${sharedHelpers}
const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node mapper.mjs <export.csv>");
  process.exit(1);
}

const rows = csvRows(inputPath);
const events = rows
  .map((row) => {
    const amount = numberOrNull(row.amount);
    if (amount === null) return null;
    return {
      ts: isoDate(row.ts || row.date),
      source: "csv_import",
      type: amount >= 0 ? "income" : "expense",
      data: {
        amount,
        currency: row.currency || "USD",
        description: row.description || "",
        category: row.category || "uncategorized",
        confidence: "inferred",
        ref: row.id || row.reference || null,
        source_doc: inputPath,
        source_row: row.__row,
        provenance: {
          import_kind: "generic-csv",
          row_snapshot: row,
        },
      },
    };
  })
  .filter(Boolean);

for (const event of events) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}
`,
    "fills-csv": `${sharedHelpers}
const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node mapper.mjs <fills.csv>");
  process.exit(1);
}

const rows = csvRows(inputPath);
const events = rows
  .map((row) => {
    const quantity = numberOrNull(row.quantity || row.qty);
    const price = numberOrNull(row.price);
    const fee = numberOrNull(row.fee);
    if (quantity === null || price === null) return null;
    const gross = quantity * price;
    return {
      ts: isoDate(row.executed_at || row.date),
      source: "fills_import",
      type: "trade_fill",
      data: {
        amount: gross,
        currency: row.quote_currency || row.currency || "USD",
        base_currency: row.base_currency || null,
        side: row.side || null,
        quantity,
        unit_price: price,
        fee,
        venue: row.venue || row.exchange || null,
        category: "trade_fill",
        confidence: "clear",
        ref: row.trade_id || row.order_id || null,
        source_doc: inputPath,
        source_row: row.__row,
        provenance: {
          import_kind: "fills-csv",
          row_snapshot: row,
        },
      },
    };
  })
  .filter(Boolean);

for (const event of events) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}
`,
    "manual-batch": `const batch = [
  {
    ts: "2026-01-31T00:00:00.000Z",
    source: "manual_batch",
    type: "expense",
    data: {
      amount: -25,
      currency: "USD",
      description: "Replace with actual event",
      category: "uncategorized",
      confidence: "inferred",
      provenance: {
        import_kind: "manual-batch",
        note: "Replace this with the source notes used to build the event.",
      },
    },
  },
];

for (const event of batch) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}
`,
  };

  return templates[kind];
}

function scaffoldPythonMapper(kind: ScaffoldKind): string {
  const sharedHelpers = `import csv
import json
import sys


def csv_rows(path):
    with open(path, "r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for index, row in enumerate(reader, start=2):
            row["__row"] = str(index)
            rows.append({key: (value or "").strip() if isinstance(value, str) else value for key, value in row.items()})
        return rows


def iso_date(value):
    if not value:
        return None
    if "T" in value:
        return value
    return f"{value}T00:00:00.000Z"


def number_or_none(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None
`;

  const templates: Record<ScaffoldKind, string> = {
    "statement-csv": `${sharedHelpers}
if len(sys.argv) < 2:
    print("Usage: python3 mapper.py <statement.csv>", file=sys.stderr)
    sys.exit(1)

input_path = sys.argv[1]
rows = list(reversed(csv_rows(input_path)))
events = []

for row in rows:
    amount = number_or_none(row.get("amount"))
    if amount is None:
        continue
    events.append({
        "ts": iso_date(row.get("posting_date") or row.get("transaction_date")),
        "source": "statement_import",
        "type": "income" if amount >= 0 else "expense",
        "data": {
            "amount": amount,
            "currency": row.get("currency") or "USD",
            "description": row.get("description") or row.get("memo") or "",
            "category": "uncategorized",
            "confidence": "inferred",
            "transaction_date": row.get("transaction_date") or None,
            "posting_date": row.get("posting_date") or None,
            "source_doc": input_path,
            "source_row": row.get("__row"),
            "provenance": {
                "import_kind": "statement-csv",
                "row_snapshot": row,
            },
        },
    })

for event in events:
    print(json.dumps(event))
`,
    "generic-csv": `${sharedHelpers}
if len(sys.argv) < 2:
    print("Usage: python3 mapper.py <export.csv>", file=sys.stderr)
    sys.exit(1)

input_path = sys.argv[1]
events = []

for row in csv_rows(input_path):
    amount = number_or_none(row.get("amount"))
    if amount is None:
        continue
    events.append({
        "ts": iso_date(row.get("ts") or row.get("date")),
        "source": "csv_import",
        "type": "income" if amount >= 0 else "expense",
        "data": {
            "amount": amount,
            "currency": row.get("currency") or "USD",
            "description": row.get("description") or "",
            "category": row.get("category") or "uncategorized",
            "confidence": "inferred",
            "ref": row.get("id") or row.get("reference"),
            "source_doc": input_path,
            "source_row": row.get("__row"),
            "provenance": {
                "import_kind": "generic-csv",
                "row_snapshot": row,
            },
        },
    })

for event in events:
    print(json.dumps(event))
`,
    "fills-csv": `${sharedHelpers}
if len(sys.argv) < 2:
    print("Usage: python3 mapper.py <fills.csv>", file=sys.stderr)
    sys.exit(1)

input_path = sys.argv[1]
events = []

for row in csv_rows(input_path):
    quantity = number_or_none(row.get("quantity") or row.get("qty"))
    price = number_or_none(row.get("price"))
    fee = number_or_none(row.get("fee"))
    if quantity is None or price is None:
        continue
    gross = quantity * price
    events.append({
        "ts": iso_date(row.get("executed_at") or row.get("date")),
        "source": "fills_import",
        "type": "trade_fill",
        "data": {
            "amount": gross,
            "currency": row.get("quote_currency") or row.get("currency") or "USD",
            "base_currency": row.get("base_currency"),
            "side": row.get("side"),
            "quantity": quantity,
            "unit_price": price,
            "fee": fee,
            "venue": row.get("venue") or row.get("exchange"),
            "category": "trade_fill",
            "confidence": "clear",
            "ref": row.get("trade_id") or row.get("order_id"),
            "source_doc": input_path,
            "source_row": row.get("__row"),
            "provenance": {
                "import_kind": "fills-csv",
                "row_snapshot": row,
            },
        },
    })

for event in events:
    print(json.dumps(event))
`,
    "manual-batch": `import json

batch = [
    {
        "ts": "2026-01-31T00:00:00.000Z",
        "source": "manual_batch",
        "type": "expense",
        "data": {
            "amount": -25,
            "currency": "USD",
            "description": "Replace with actual event",
            "category": "uncategorized",
            "confidence": "inferred",
            "provenance": {
                "import_kind": "manual-batch",
                "note": "Replace this with the source notes used to build the event.",
            },
        },
    },
]

for event in batch:
    print(json.dumps(event))
`,
  };

  return templates[kind];
}

export function cmdImport(args: string[], params: ImportParams) {
  const f = flags(args);
  const p = positional(args);

  if (p[0] === "check") {
    const inputPath = p[1];
    if (!inputPath) {
      console.error("Usage: clawbooks import check <events.jsonl> [--statement profile.json] [--count N] [--debits N] [--credits N] [--opening-balance N] [--closing-balance N] [--date-basis ledger|transaction|posting] [--statement-start YYYY-MM-DD] [--statement-end YYYY-MM-DD] [--currency C]");
      process.exit(1);
    }

    const profile = f.statement ? readStatementProfile(resolve(f.statement)) : {};
    const dateBasis = (f["date-basis"] ?? profile.date_basis ?? "ledger") as DateBasis;
    if (!["ledger", "transaction", "posting"].includes(dateBasis)) {
      console.error("Invalid --date-basis. Use ledger, transaction, or posting.");
      process.exit(1);
    }

    const rawEvents = readEventsFile(resolve(inputPath));
    const allEvents = sortByTimestamp(rawEvents);
    let events = allEvents;
    const currency = f.currency ?? profile.currency;
    if (currency) events = events.filter((event) => String(event.data.currency) === currency);
    if (profile.source) events = events.filter((event) => event.source === profile.source);

    const statementStart = f["statement-start"] ?? profile.statement_start;
    const statementEnd = f["statement-end"] ?? profile.statement_end;
    const filteredByBasis = filterByDateBasis(events, {
      after: statementStart ? `${statementStart}T00:00:00.000Z` : undefined,
      before: statementEnd ? `${statementEnd}T23:59:59.999Z` : undefined,
      basis: dateBasis,
    });
    const scopedEvents = filteredByBasis.events;
    const outOfPeriodCount = events.length - scopedEvents.length - filteredByBasis.missingBasisIds.length;
    const totals = sumBySign(scopedEvents);
    const range = dateRange(scopedEvents, dateBasis);
    const issues: string[] = [];
    const expected: Record<string, number | string> = {};
    const actual: Record<string, number | string | null> = {
      count: scopedEvents.length,
      debits: totals.debits,
      credits: totals.credits,
      net_movement: totals.net,
      first_date: range.first,
      last_date: range.last,
    };
    const differences: Record<string, number> = {};
    const provenance = provenanceCoverage(scopedEvents);
    const dates = dateCoverage(scopedEvents);
    const ordering = orderingProfile(rawEvents, dateBasis);
    const duplicateRefList = duplicateRefs(scopedEvents);

    if (f.count !== undefined || profile.count !== undefined) {
      expected.count = f.count !== undefined ? parseInt(f.count) : Number(profile.count);
      differences.count = scopedEvents.length - Number(expected.count);
      if (differences.count !== 0) issues.push(`Count mismatch: expected ${expected.count}, got ${scopedEvents.length}`);
    }
    if (f.debits !== undefined || profile.debits !== undefined) {
      expected.debits = f.debits !== undefined ? parseFloat(f.debits) : Number(profile.debits);
      differences.debits = round2(totals.debits - Number(expected.debits));
      if (Math.abs(differences.debits) > 0.01) issues.push(`Debits mismatch: expected ${expected.debits}, got ${totals.debits}`);
    }
    if (f.credits !== undefined || profile.credits !== undefined) {
      expected.credits = f.credits !== undefined ? parseFloat(f.credits) : Number(profile.credits);
      differences.credits = round2(totals.credits - Number(expected.credits));
      if (Math.abs(differences.credits) > 0.01) issues.push(`Credits mismatch: expected ${expected.credits}, got ${totals.credits}`);
    }
    if (f["opening-balance"] !== undefined || profile.opening_balance !== undefined) {
      expected.opening_balance = f["opening-balance"] !== undefined ? parseFloat(f["opening-balance"]) : Number(profile.opening_balance);
      actual.opening_balance = Number(expected.opening_balance);
    }
    if (f["closing-balance"] !== undefined || profile.closing_balance !== undefined) {
      expected.closing_balance = f["closing-balance"] !== undefined ? parseFloat(f["closing-balance"]) : Number(profile.closing_balance);
      actual.closing_balance = round2((Number(actual.opening_balance ?? 0)) + totals.net);
      differences.closing_balance = round2(Number(actual.closing_balance) - Number(expected.closing_balance));
      if (Math.abs(differences.closing_balance) > 0.01) {
        issues.push(`Closing balance mismatch: expected ${expected.closing_balance}, got ${actual.closing_balance}`);
      }
    }
    if (statementStart) {
      expected.statement_start = statementStart;
      if (range.first && range.first < statementStart) issues.push(`First ${dateBasis} date ${range.first} falls before statement_start ${statementStart}`);
    }
    if (statementEnd) {
      expected.statement_end = statementEnd;
      if (range.last && range.last > statementEnd) issues.push(`Last ${dateBasis} date ${range.last} falls after statement_end ${statementEnd}`);
    }
    if (outOfPeriodCount > 0) {
      issues.push(`${outOfPeriodCount} staged event(s) fall outside the requested statement period and were excluded from scoped checks.`);
    }
    if (profile.newest_first === true && ordering.order !== "descending") {
      issues.push(`Statement profile says newest_first=true, but the staged file appears ${ordering.order} by ${dateBasis} date.`);
    }
    if (profile.newest_first === false && ordering.order !== "ascending") {
      issues.push(`Statement profile says newest_first=false, but the staged file appears ${ordering.order} by ${dateBasis} date.`);
    }

    console.log(JSON.stringify({
      command: "import check",
      input_path: resolve(inputPath),
      statement_profile_path: f.statement ? resolve(f.statement) : null,
      statement_profile: Object.keys(profile).length > 0 ? profile : null,
      date_basis: dateBasis,
      currency: currency ?? null,
      expected,
      actual,
      differences,
      status: issues.length === 0 ? "ok" : "mismatch",
      issues,
      missing_date_basis_events: filteredByBasis.missingBasisIds,
      out_of_period_events: outOfPeriodCount,
      event_types: eventCountsByType(scopedEvents),
      provenance_coverage: provenance,
      date_coverage: dates,
      ordering,
      duplicate_refs: duplicateRefList,
      next_steps: issues.length === 0
        ? [
          "Review the staged JSONL once more, then append with `clawbooks batch`.",
          "Run `clawbooks verify`, `clawbooks reconcile`, and `clawbooks review` after append.",
        ]
        : [
          "Adjust the mapper or source assumptions before appending.",
          "Re-run `clawbooks import check` until the staged file matches the statement expectations.",
        ],
    }, null, 2));
    return;
  }

  if (f["list-scaffolds"] === "true" || f.list === "true" || (p[0] === "scaffold" && p.length === 1)) {
    console.log(JSON.stringify({
      command: "import scaffold",
      scaffolds: [
        { name: "statement-csv", description: "Monthly or bounded statements with opening/closing semantics" },
        { name: "generic-csv", description: "General transaction or event exports without statement semantics" },
        { name: "fills-csv", description: "Broker or exchange fills / trade-history style exports" },
        { name: "manual-batch", description: "Small hand-authored JSONL batches with explicit provenance" },
      ],
    }, null, 2));
    return;
  }

  if (p[0] !== "scaffold") {
    console.error("Usage: clawbooks import scaffold <statement-csv|generic-csv|fills-csv|manual-batch> [--out DIR]");
    process.exit(1);
  }

  const kind = p[1] as ScaffoldKind | undefined;
  if (!kind || !VALID_KINDS.includes(kind)) {
    console.error(`Unknown scaffold kind "${kind ?? ""}". Available kinds: ${VALID_KINDS.join(", ")}`);
    process.exit(1);
  }

  const outDir = resolve(f.out ?? defaultOutDir(kind, params.booksDir));
  mkdirSync(outDir, { recursive: true });

  const files = [
    { path: join(outDir, "README.md"), content: scaffoldReadme(kind) },
    { path: join(outDir, "mapper.mjs"), content: scaffoldMapper(kind) },
    { path: join(outDir, "mapper.py"), content: scaffoldPythonMapper(kind) },
    ...(kind === "statement-csv" ? [{ path: join(outDir, "statement-profile.json"), content: statementProfileTemplate() }] : []),
  ];

  const fileResults = files.map((file) => {
    const existed = existsSync(file.path);
    if (!existed) writeFileSync(file.path, file.content, "utf-8");
    return { path: file.path, created: !existed };
  });

  console.log(JSON.stringify({
    command: "import scaffold",
    kind,
    out_dir: outDir,
    files: fileResults,
    next_steps: [
      "Edit mapper.mjs to match the source columns and event types.",
      "Or edit mapper.py if Python is the better fit for the import task.",
      "Run the mapper and review its JSONL output before appending.",
      "Append with `clawbooks batch`, then run `clawbooks verify`, `clawbooks reconcile`, and `clawbooks review`.",
    ],
  }, null, 2));
}
