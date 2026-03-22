import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { positional, flags } from "../cli-helpers.js";
import { type DateBasis } from "../imports.js";
import { readAll, type LedgerEvent } from "../ledger.js";
import {
  buildImportCheck,
  buildImportReconciliation,
  dateCoverage,
  duplicateRefs,
  eventCountsByType,
  mappingDiagnostics,
  orderingProfile,
  provenanceCoverage,
  suggestMappings,
  validateMappingsFile,
  type StatementProfile,
  type VendorMapping,
} from "../operations.js";
import { buildWorkflowStatus } from "../workflow-state.js";

type ImportParams = {
  booksDir: string | null;
  ledgerPath: string;
};

type ScaffoldKind = "statement-csv" | "generic-csv" | "fills-csv" | "manual-batch";

type ImportSessionRecord = {
  import_session: string;
  session_schema_version: string;
  created_at: string;
  recorded_via: string;
  operator_identity: string | null;
  notes: string | null;
  mapper_path: string | null;
  scaffold_kind: string | null;
  input_path: string;
  statement_profile_path: string | null;
  status: string;
  workflow_state: string;
  reporting_mode: string;
  classification_basis: string;
  workflow_acknowledged: boolean;
  workflow_state_path: string | null;
  program_path: string | null;
  policy_path: string | null;
  program_hash: string | null;
  policy_hash: string | null;
  date_basis: string;
  currency: string | null;
  expected: Record<string, number | string>;
  actual: Record<string, number | string | null>;
  differences: Record<string, number>;
  issue_count: number;
  issues: string[];
  source_coverage: Record<string, unknown>;
  input_event_count: number;
  filtered_event_count: number;
  scoped_event_count: number;
  provenance_coverage: ReturnType<typeof provenanceCoverage>;
  date_coverage: ReturnType<typeof dateCoverage>;
  mapping_diagnostics: Record<string, unknown>;
  ordering: {
    filtered: ReturnType<typeof orderingProfile>;
    scoped: ReturnType<typeof orderingProfile>;
  };
  duplicate_refs: string[];
};

const VALID_KINDS: ScaffoldKind[] = ["statement-csv", "generic-csv", "fills-csv", "manual-batch"];

function readVendorMappings(path: string | null): { path: string | null; mappings: VendorMapping[]; issues: string[] } {
  if (!path) return { path: null, mappings: [], issues: [] };
  if (!existsSync(path)) return { path: resolve(path), mappings: [], issues: [`No vendor mappings file found at ${resolve(path)}`] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    const mappings = Array.isArray(parsed.mappings)
      ? parsed.mappings.filter((mapping: unknown): mapping is VendorMapping => typeof (mapping as VendorMapping | undefined)?.match === "string" && Boolean((mapping as VendorMapping).match.trim()))
      : [];
    const issues: string[] = [];
    if (!Array.isArray(parsed.mappings)) issues.push("Mappings file does not contain a top-level `mappings` array.");
    return { path: resolve(path), mappings, issues };
  } catch {
    return { path: resolve(path), mappings: [], issues: [`Failed to parse vendor mappings JSON from ${resolve(path)}`] };
  }
}

function resolveVendorMappingsPaths(
  explicitPath: string | undefined,
  statementPath: string | undefined,
  inputPath: string | undefined,
  booksDir: string | null,
): { used: string | null; checked: string[] } {
  const checked = [
    explicitPath ? resolve(explicitPath) : null,
    statementPath ? join(dirname(resolve(statementPath)), "vendor-mappings.json") : null,
    inputPath ? join(dirname(resolve(inputPath)), "vendor-mappings.json") : null,
    booksDir ? resolve(booksDir, "vendor-mappings.json") : null,
    booksDir ? resolve(booksDir, "imports", "vendor-mappings.json") : null,
    booksDir ? resolve(booksDir, "imports", "statement-csv", "vendor-mappings.json") : null,
  ].filter((candidate, index, list): candidate is string => Boolean(candidate) && list.indexOf(candidate) === index);
  return {
    used: checked.find((candidate) => existsSync(candidate)) ?? null,
    checked,
  };
}

function sessionsDirFor(booksDir: string | null, ledgerPath: string): string {
  return booksDir && existsSync(booksDir)
    ? resolve(booksDir, "imports", "sessions")
    : resolve(dirname(resolve(ledgerPath)), "clawbooks-import-sessions");
}

function readSessionRecord(path: string): ImportSessionRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function listSessionFiles(booksDir: string | null, ledgerPath: string): string[] {
  const dir = sessionsDirFor(booksDir, ledgerPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(dir, name))
    .sort();
}

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

function vendorMappingsTemplate(): string {
  return JSON.stringify({
    mappings: [
      {
        match: "APPLE.COM/BILL",
        type: "expense",
        category: "software_and_digital_services",
        confidence: "inferred",
      },
      {
        match: "PAYROLL",
        type: "income",
        category: "service_revenue",
        confidence: "inferred",
      },
    ],
  }, null, 2) + "\n";
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
    "5. Use `clawbooks import mappings suggest` or `clawbooks import mappings check` only if recurring description hints would help.",
    "6. Use `clawbooks batch`, `clawbooks verify`, `clawbooks reconcile`, and `clawbooks review` after import.",
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
      "- If repeated vendors need stable classification hints, keep them in `vendor-mappings.json` and let the mapper consult that file.",
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function loadMappings() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "vendor-mappings.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.mappings) ? parsed.mappings : [];
  } catch {
    return [];
  }
}

function applyMapping(description, mappings) {
  const upper = String(description || "").toUpperCase();
  return mappings.find((mapping) => upper.includes(String(mapping.match || "").toUpperCase())) || null;
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
const mappings = loadMappings();
const events = rows
  .slice()
  .reverse()
  .map((row) => {
    const debit = numberOrNull(row.debit);
    const credit = numberOrNull(row.credit);
    const balance = numberOrNull(row.balance);
    const amount = (credit ?? 0) - (debit ?? 0);
    if (amount === null) return null;
    if (amount === 0 && debit === null && credit === null) return null;
    const description = row.description || row.memo || row.details || "";
    const mapping = applyMapping(description, mappings);
    return {
      ts: isoDate(row.posting_date || row.transaction_date),
      source: "statement_import",
      type: mapping?.type || (amount >= 0 ? "income" : "expense"),
      data: {
        amount,
        currency: row.currency || "USD",
        description,
        category: mapping?.category || "uncategorized",
        confidence: mapping?.confidence || "inferred",
        transaction_date: row.transaction_date || null,
        posting_date: row.posting_date || null,
        balance: balance ?? null,
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
from pathlib import Path


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


def load_mappings():
    try:
        path = Path(__file__).with_name("vendor-mappings.json")
        parsed = json.loads(path.read_text(encoding="utf-8"))
        mappings = parsed.get("mappings", [])
        return mappings if isinstance(mappings, list) else []
    except Exception:
        return []


def apply_mapping(description, mappings):
    upper = str(description or "").upper()
    for mapping in mappings:
        if str(mapping.get("match", "")).upper() in upper:
            return mapping
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
mappings = load_mappings()

for row in rows:
    debit = number_or_none(row.get("debit"))
    credit = number_or_none(row.get("credit"))
    balance = number_or_none(row.get("balance"))
    amount = (credit or 0) - (debit or 0)
    if amount == 0 and debit is None and credit is None:
        continue
    description = row.get("description") or row.get("memo") or row.get("details") or ""
    mapping = apply_mapping(description, mappings)
    events.append({
        "ts": iso_date(row.get("posting_date") or row.get("transaction_date")),
        "source": "statement_import",
        "type": mapping.get("type") if mapping else ("income" if amount >= 0 else "expense"),
        "data": {
            "amount": amount,
            "currency": row.get("currency") or "USD",
            "description": description,
            "category": mapping.get("category") if mapping else "uncategorized",
            "confidence": mapping.get("confidence") if mapping else "inferred",
            "transaction_date": row.get("transaction_date") or None,
            "posting_date": row.get("posting_date") or None,
            "balance": balance,
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
  const workflow = buildWorkflowStatus({
    booksDir: params.booksDir,
    policyPath: join(dirname(resolve(params.ledgerPath)), "policy.md"),
  });

  if (p[0] === "sessions") {
    const action = p[1] ?? "list";
    const files = listSessionFiles(params.booksDir, params.ledgerPath);
    const sessions = files
      .map((path) => ({ path, session: readSessionRecord(path) }))
      .filter((entry): entry is { path: string; session: ImportSessionRecord } => entry.session !== null)
      .sort((a, b) => a.session.created_at.localeCompare(b.session.created_at));

    if (action === "list") {
      console.log(JSON.stringify({
        command: "import sessions list",
        sessions_dir: sessionsDirFor(params.booksDir, params.ledgerPath),
        session_count: sessions.length,
        sessions: sessions.slice(-20).reverse().map(({ path, session }) => ({
          import_session: session.import_session,
          created_at: session.created_at,
          status: session.status,
          workflow_state: session.workflow_state,
          reporting_mode: session.reporting_mode,
          classification_basis: session.classification_basis,
          workflow_acknowledged: session.workflow_acknowledged,
          input_path: session.input_path,
          statement_profile_path: session.statement_profile_path,
          operator_identity: session.operator_identity,
          path,
        })),
        next_steps: sessions.length === 0
          ? ["Run `clawbooks import check ... --save-session` to create an import session record."]
          : ["Use `clawbooks import sessions show <session-id>` to inspect a specific saved session."],
      }, null, 2));
      return;
    }

    if (action === "show") {
      const target = p[2];
      if (!target) {
        console.error("Usage: clawbooks import sessions show <session-id|latest>");
        process.exit(1);
      }
      const match = target === "latest"
        ? sessions.at(-1)
        : sessions.find(({ session, path }) => session.import_session === target || path.endsWith(`/${target}.json`));
      if (!match) {
        console.error(`No import session found for "${target}".`);
        process.exit(1);
      }
      console.log(JSON.stringify({
        command: "import sessions show",
        path: match.path,
        ...match.session,
      }, null, 2));
      return;
    }

    console.error("Usage: clawbooks import sessions <list|show> [session-id|latest]");
    process.exit(1);
  }

  if (p[0] === "reconcile") {
    const inputPath = p[1];
    if (!inputPath || !f.statement) {
      console.error("Usage: clawbooks import reconcile <events.jsonl> --statement profile.json [--out PATH] [--date-basis ledger|transaction|posting] [--currency C]");
      process.exit(1);
    }

    const profile = readStatementProfile(resolve(f.statement));
    const dateBasis = (f["date-basis"] ?? profile.date_basis ?? "ledger") as DateBasis;
    if (!["ledger", "transaction", "posting"].includes(dateBasis)) {
      console.error("Invalid --date-basis. Use ledger, transaction, or posting.");
      process.exit(1);
    }

    const artifact = buildImportReconciliation({
      inputPath: resolve(inputPath),
      ledgerPath: resolve(params.ledgerPath),
      rawEvents: readEventsFile(resolve(inputPath)),
      allLedger: existsSync(params.ledgerPath) ? readAll(params.ledgerPath) : [],
      profile,
      dateBasis,
      currency: f.currency,
      statementStart: f["statement-start"],
      statementEnd: f["statement-end"],
    });

    if (f.out) {
      const outPath = resolve(f.out);
      writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");
    }

    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  if (p[0] === "mappings") {
    const action = p[1];
    if (!action || action === "--list" || action === "list" || f.list === "true") {
      console.log(JSON.stringify({
        command: "import mappings",
        actions: [
          { name: "suggest", description: "Suggest vendor mapping candidates from stable ledger history" },
          { name: "check", description: "Validate a mappings file and optionally compare it to staged events" },
        ],
      }, null, 2));
      return;
    }
    const mappingsResolution = resolveVendorMappingsPaths(f.mappings, undefined, p[2], params.booksDir);
    const loadedMappings = readVendorMappings(mappingsResolution.used);
    const ledgerEvents = existsSync(params.ledgerPath) ? readAll(params.ledgerPath) : [];

    if (action === "suggest") {
      if (!existsSync(params.ledgerPath)) {
        console.error("No ledger found for `import mappings suggest`. Run it inside a books directory or use clawbooks where/doctor first.");
        process.exit(1);
      }
      const minOccurrences = Math.max(2, parseInt(f["min-occurrences"] ?? "3") || 3);
      const sourceFilter = f.source;
      const history = sourceFilter ? ledgerEvents.filter((event) => event.source === sourceFilter) : ledgerEvents;
      const suggestions = suggestMappings(history, loadedMappings.mappings, minOccurrences);
      const result = {
        command: "import mappings suggest",
        ledger_path: resolve(params.ledgerPath),
        mappings_path: loadedMappings.path,
        mappings_paths_checked: mappingsResolution.checked,
        min_occurrences: minOccurrences,
        source: sourceFilter ?? null,
        existing_mapping_count: loadedMappings.mappings.length,
        existing_mapping_issues: loadedMappings.issues,
        candidate_summary: {
          total_candidates: suggestions.total_candidates,
          uncovered_candidates: suggestions.uncovered_candidates,
        },
        suggestions: suggestions.suggestions,
        next_steps: [
          "Review the suggested mappings before copying any of them into vendor-mappings.json.",
          "Keep vendor mappings as factual recurring hints, not as a replacement for policy.md.",
          "Re-run `clawbooks import check` after updating mappings to see coverage and conflict signals.",
        ],
      };
      if (f.out) {
        const outPath = resolve(f.out);
        writeFileSync(outPath, JSON.stringify({
          generated_at: new Date().toISOString(),
          source: "clawbooks import mappings suggest",
          ledger_path: resolve(params.ledgerPath),
          mappings: suggestions.suggestions.filter((item) => !item.already_covered).map((item) => item.suggested_mapping),
        }, null, 2) + "\n", "utf-8");
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (action === "check") {
      const inputPath = p[2];
      const events = inputPath ? readEventsFile(resolve(inputPath)) : [];
      const mappingFileChecks = validateMappingsFile(loadedMappings.mappings);
      const diagnostics = inputPath ? mappingDiagnostics(events, loadedMappings.mappings, ledgerEvents) : null;
      const issues = [
        ...loadedMappings.issues,
        ...(mappingFileChecks.duplicate_match_count > 0 ? [`${mappingFileChecks.duplicate_match_count} duplicate normalized mapping match(es) detected.`] : []),
        ...(mappingFileChecks.overlap_count > 0 ? [`${mappingFileChecks.overlap_count} overlapping mapping match(es) detected.`] : []),
      ];
      console.log(JSON.stringify({
        command: "import mappings check",
        mappings_path: loadedMappings.path,
        mappings_paths_checked: mappingsResolution.checked,
        input_path: inputPath ? resolve(inputPath) : null,
        ledger_path: existsSync(params.ledgerPath) ? resolve(params.ledgerPath) : null,
        status: issues.length === 0 ? "ok" : "warn",
        issues,
        file_checks: mappingFileChecks,
        event_diagnostics: diagnostics,
        next_steps: [
          "Remove duplicate or overlapping match rules before relying on vendor mappings heavily.",
          "Treat vendor mappings as operator-maintained hints and consistency checks, not as hidden accounting logic.",
        ],
      }, null, 2));
      return;
    }

    console.error("Usage: clawbooks import mappings <suggest|check> [events.jsonl] [--mappings PATH] [--min-occurrences N] [--source S] [--out PATH]");
    process.exit(1);
  }

  if (p[0] === "check") {
    const inputPath = p[1];
    if (!inputPath) {
      console.error("Usage: clawbooks import check <events.jsonl> [--statement profile.json] [--mappings PATH] [--count N] [--debits N] [--credits N] [--opening-balance N] [--closing-balance N] [--date-basis ledger|transaction|posting] [--statement-start YYYY-MM-DD] [--statement-end YYYY-MM-DD] [--currency C] [--save-session] [--session-id ID]");
      process.exit(1);
    }

    const profile = f.statement ? readStatementProfile(resolve(f.statement)) : {};
    const dateBasis = (f["date-basis"] ?? profile.date_basis ?? "ledger") as DateBasis;
    if (!["ledger", "transaction", "posting"].includes(dateBasis)) {
      console.error("Invalid --date-basis. Use ledger, transaction, or posting.");
      process.exit(1);
    }

    const rawEvents = readEventsFile(resolve(inputPath));
    const mappingsResolution = resolveVendorMappingsPaths(f.mappings, f.statement, inputPath, params.booksDir);
    const loadedMappings = readVendorMappings(mappingsResolution.used);
    const ledgerHistoryEvents = existsSync(params.ledgerPath) ? readAll(params.ledgerPath) : [];
    const report = buildImportCheck({
      inputPath: resolve(inputPath),
      statementProfilePath: f.statement ? resolve(f.statement) : null,
      rawEvents,
      ledgerHistoryEvents,
      workflow,
      profile: {
        ...profile,
        ...(f.count !== undefined ? { count: parseInt(f.count) } : {}),
        ...(f.debits !== undefined ? { debits: parseFloat(f.debits) } : {}),
        ...(f.credits !== undefined ? { credits: parseFloat(f.credits) } : {}),
        ...(f["opening-balance"] !== undefined ? { opening_balance: parseFloat(f["opening-balance"]) } : {}),
        ...(f["closing-balance"] !== undefined ? { closing_balance: parseFloat(f["closing-balance"]) } : {}),
      },
      dateBasis,
      currency: f.currency,
      sourceFilter: f.source ?? null,
      mappings: {
        checkedPaths: mappingsResolution.checked,
        path: loadedMappings.path,
        issues: loadedMappings.issues,
        mappings: loadedMappings.mappings,
      },
      classificationBasis: f["classification-basis"],
      mapperPath: f.mapper ? resolve(f.mapper) : null,
      recordedBy: f["recorded-by"] ?? null,
      statementStart: f["statement-start"],
      statementEnd: f["statement-end"],
    });

    console.log(JSON.stringify(report, null, 2));

    if (f["save-session"] === "true") {
      const sessionId = f["session-id"] ?? `import-session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const sessionsDir = sessionsDirFor(params.booksDir, params.ledgerPath);
      mkdirSync(sessionsDir, { recursive: true });
      const sessionPath = resolve(sessionsDir, `${sessionId}.json`);
      const sessionRecord: ImportSessionRecord = {
        import_session: sessionId,
        session_schema_version: "clawbooks.import-session.v1",
        created_at: new Date().toISOString(),
        recorded_via: "clawbooks import check",
        operator_identity: f["recorded-by"] ?? null,
        notes: f.notes ?? null,
        mapper_path: f.mapper ? resolve(f.mapper) : null,
        scaffold_kind: f.scaffold ?? null,
        input_path: resolve(inputPath),
        statement_profile_path: f.statement ? resolve(f.statement) : null,
        status: report.status,
        reporting_mode: report.reporting_mode,
        classification_basis: report.classification_basis,
        workflow_acknowledged: workflow.reporting_readiness === "ready",
        workflow_state_path: workflow.state_path,
        program_path: workflow.program.path,
        policy_path: workflow.policy.path,
        program_hash: workflow.program.sha256,
        policy_hash: workflow.policy.sha256,
        date_basis: dateBasis,
        currency: report.currency,
        workflow_state: report.workflow_state,
        expected: report.expected,
        actual: report.actual,
        differences: report.differences,
        issue_count: report.issues.length,
        issues: report.issues,
        source_coverage: report.source_coverage,
        input_event_count: report.input_event_count,
        filtered_event_count: report.filtered_event_count,
        scoped_event_count: Number(report.source_coverage.scoped_events ?? 0),
        provenance_coverage: report.provenance_coverage,
        date_coverage: report.date_coverage,
        mapping_diagnostics: report.mapping_diagnostics,
        ordering: report.ordering,
        duplicate_refs: report.duplicate_refs,
      };
      writeFileSync(sessionPath, JSON.stringify(sessionRecord, null, 2) + "\n", "utf-8");
      console.error(`Saved import session: ${sessionPath}`);
    }
    return;
  }

  if (f["list-scaffolds"] === "true" || f.list === "true") {
    console.log(JSON.stringify({
      command: "import scaffold",
      workflow,
      reporting_mode: workflow.reporting_mode,
      classification_basis: workflow.classification_basis,
      workflow_warning: workflow.warning,
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
    console.error("Usage: clawbooks import scaffold <statement-csv|generic-csv|fills-csv|manual-batch> [--out DIR]\n       clawbooks import mappings <suggest|check> [events.jsonl] [--mappings PATH] [--min-occurrences N] [--source S] [--out PATH]");
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
    ...(kind === "statement-csv" ? [{ path: join(outDir, "vendor-mappings.json"), content: vendorMappingsTemplate() }] : []),
  ];

  const fileResults = files.map((file) => {
    const existed = existsSync(file.path);
    if (!existed) writeFileSync(file.path, file.content, "utf-8");
    return { path: file.path, created: !existed };
  });

  console.log(JSON.stringify({
    command: "import scaffold",
    workflow,
    reporting_mode: workflow.reporting_mode,
    classification_basis: workflow.classification_basis,
    workflow_warning: workflow.warning,
    status_line: workflow.reporting_mode === "policy_grounded"
      ? "Status: POLICY_GROUNDED"
      : "Status: PROVISIONAL",
    kind,
    out_dir: outDir,
    files: fileResults,
    next_steps: [
      "Edit mapper.mjs to match the source columns and event types.",
      "Or edit mapper.py if Python is the better fit for the import task.",
      "Run the mapper and review its JSONL output before appending.",
      "Use `clawbooks import mappings suggest` later if you want factual recurring vendor hints from ledger history.",
      "Append with `clawbooks batch`, then run `clawbooks verify`, `clawbooks reconcile`, and `clawbooks review`.",
    ],
  }, null, 2));
}
