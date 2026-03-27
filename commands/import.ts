import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
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
  matchingMapping,
  normalizeVendorText,
  orderingProfile,
  prepareBatch,
  provenanceCoverage,
  stableHistorySummary,
  suggestMappings,
  topEntry,
  validateMappingsFile,
  vendorHistory,
  type StatementProfile,
  type VendorMapping,
} from "../operations.js";
import { VALID_CLASSIFICATION_BASES, buildWorkflowStatus, deriveReportingMode } from "../workflow-state.js";

type ImportParams = {
  booksDir: string | null;
  ledgerPath: string;
};

type ScaffoldKind = "statement-csv" | "generic-csv" | "fills-csv" | "manual-batch" | "opening-balances";

type ImportRunField = "transaction_date" | "posting_date" | "description" | "debit" | "credit" | "amount" | "balance" | "currency" | "ref" | "category" | "type" | "confidence";

type ImportRunColumns = Record<ImportRunField, string | null>;

type ParsedCsv = {
  delimiter: string;
  headers: string[];
  rows: Array<Record<string, string>>;
};

type ImportSessionRecord = {
  import_session: string;
  session_schema_version: string;
  created_at: string;
  recorded_via: string;
  source_doc: string | null;
  source_hash: string | null;
  apparent_source_entity: string | null;
  entity_mismatch: boolean | null;
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

const VALID_KINDS: ScaffoldKind[] = ["statement-csv", "generic-csv", "fills-csv", "manual-batch", "opening-balances"];

const IMPORT_RUN_ALIASES: Record<ImportRunField, string[]> = {
  transaction_date: ["transaction_date", "transaction date", "date", "trans date", "transactiondate"],
  posting_date: ["posting_date", "posting date", "posted_date", "posted date", "post date", "valuedate", "value date"],
  description: ["description", "memo", "details", "narrative", "payee", "merchant", "name"],
  debit: ["debit", "debits", "withdrawal", "outflow"],
  credit: ["credit", "credits", "deposit", "inflow"],
  amount: ["amount", "signed_amount", "signed amount", "value"],
  balance: ["balance", "running_balance", "running balance"],
  currency: ["currency", "ccy"],
  ref: ["ref", "reference", "transaction_id", "transaction id", "id"],
  category: ["category", "source_category", "source category"],
  type: ["type", "event_type", "event type"],
  confidence: ["confidence"],
};

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

function firstImportSourceMetadata(events: LedgerEvent[]) {
  const firstWithDoc = events.find((event) => typeof event.data?.source_doc === "string" && event.data.source_doc.trim().length > 0);
  const firstWithHash = events.find((event) => typeof event.data?.source_hash === "string" && event.data.source_hash.trim().length > 0);
  return {
    sourceDoc: firstWithDoc && typeof firstWithDoc.data.source_doc === "string" ? firstWithDoc.data.source_doc : null,
    sourceHash: firstWithHash && typeof firstWithHash.data.source_hash === "string" ? firstWithHash.data.source_hash : null,
  };
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

function openingBalancesTemplate(): string {
  return [
    "ts,account,amount,currency,category,description,source",
    "2026-01-01,checking,50000,USD,cash,Opening bank balance,opening_balances_import",
    "2026-01-01,credit_card,-12000,USD,liability,Opening credit card balance,opening_balances_import",
  ].join("\n") + "\n";
}

function defaultOutDir(kind: ScaffoldKind, booksDir: string | null): string {
  if (booksDir && existsSync(booksDir)) return resolve(booksDir, "imports", kind);
  return resolve("clawbooks-imports", kind);
}

function defaultStagedOutPath(inputPath: string): string {
  const resolved = resolve(inputPath);
  const ext = extname(resolved);
  const stem = ext ? basename(resolved, ext) : basename(resolved);
  return resolve(dirname(resolved), `${stem}.staged.jsonl`);
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const candidates = [",", ";", "\t"];
  const scored = candidates.map((candidate) => {
    const rows = parseDelimited(sample, candidate);
    const score = rows[0]?.length ?? 0;
    return { candidate, score };
  }).sort((left, right) => right.score - left.score);
  return scored[0]?.score && scored[0].score > 1 ? scored[0].candidate : ",";
}

function parseCsvFile(path: string, delimiterFlag?: string, skipRows = 0): ParsedCsv {
  if (!existsSync(path)) {
    console.error(`No file found at ${path}`);
    process.exit(1);
  }

  const text = readFileSync(path, "utf-8").replace(/^\uFEFF/, "").trim();
  if (!text) {
    console.error(`CSV file is empty: ${path}`);
    process.exit(1);
  }

  const delimiter = delimiterFlag ?? detectDelimiter(text);
  const rows = parseDelimited(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
  const effectiveRows = rows.slice(skipRows);
  if (effectiveRows.length !== rows.length && effectiveRows.length < 2) {
    console.error(`CSV file must contain a header and at least one data row after skipping ${skipRows} row(s): ${path}`);
    process.exit(1);
  }
  if (effectiveRows.length < 2) {
    console.error(`CSV file must contain a header and at least one data row: ${path}`);
    process.exit(1);
  }

  const headers = effectiveRows[0].map((header) => header.trim());
  return {
    delimiter,
    headers,
    rows: effectiveRows.slice(1).map((cells, index) => {
      const row = Object.fromEntries(headers.map((header, cellIndex) => [header, (cells[cellIndex] ?? "").trim()]));
      row.__row = String(index + 2 + skipRows);
      return row;
    }),
  };
}

function parseSignedNumber(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const negative = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed
    .replace(/^\((.*)\)$/, "$1")
    .replace(/[$£€¥\s]/g, "")
    .replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function coerceIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("T")) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(trimmed)) return `${trimmed.replace(/\//g, "-")}T00:00:00.000Z`;
  return null;
}

function resolveImportRunColumn(
  headers: string[],
  explicitName: string | undefined,
  field: ImportRunField,
): string | null {
  if (explicitName) {
    const found = headers.find((header) => header === explicitName);
    if (!found) {
      console.error(`Column "${explicitName}" was not found in the CSV header for ${field}.`);
      process.exit(1);
    }
    return found;
  }

  const aliases = IMPORT_RUN_ALIASES[field];
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  const match = normalizedHeaders.find(({ normalized }) => aliases.includes(normalized));
  return match?.header ?? null;
}

function resolveImportRunColumns(headers: string[], f: Record<string, string>): ImportRunColumns {
  return {
    transaction_date: resolveImportRunColumn(headers, f["transaction-date-col"], "transaction_date"),
    posting_date: resolveImportRunColumn(headers, f["posting-date-col"], "posting_date"),
    description: resolveImportRunColumn(headers, f["description-col"], "description"),
    debit: resolveImportRunColumn(headers, f["debit-col"], "debit"),
    credit: resolveImportRunColumn(headers, f["credit-col"], "credit"),
    amount: resolveImportRunColumn(headers, f["amount-col"], "amount"),
    balance: resolveImportRunColumn(headers, f["balance-col"], "balance"),
    currency: resolveImportRunColumn(headers, f["currency-col"], "currency"),
    ref: resolveImportRunColumn(headers, f["ref-col"], "ref"),
    category: resolveImportRunColumn(headers, f["category-col"], "category"),
    type: resolveImportRunColumn(headers, f["type-col"], "type"),
    confidence: resolveImportRunColumn(headers, f["confidence-col"], "confidence"),
  };
}

function rowValue(row: Record<string, string>, column: string | null): string | null {
  if (!column) return null;
  const value = row[column];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferRowAmount(row: Record<string, string>, columns: ImportRunColumns): number | null {
  const directAmount = parseSignedNumber(rowValue(row, columns.amount));
  if (directAmount !== null) return directAmount;

  const debit = parseSignedNumber(rowValue(row, columns.debit));
  const credit = parseSignedNumber(rowValue(row, columns.credit));
  if (debit === null && credit === null) return null;
  return Math.round(((credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
}

function detectInputOrder(rows: Array<Record<string, string>>, columns: ImportRunColumns): "newest-first" | "oldest-first" | "unknown" {
  if (rows.length < 2) return "unknown";
  const first = coerceIsoDate(rowValue(rows[0], columns.posting_date) ?? rowValue(rows[0], columns.transaction_date));
  const last = coerceIsoDate(rowValue(rows[rows.length - 1], columns.posting_date) ?? rowValue(rows[rows.length - 1], columns.transaction_date));
  if (!first || !last || first === last) return "unknown";
  return first > last ? "newest-first" : "oldest-first";
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
    "opening-balances": [
      "## Opening balances checklist",
      "",
      "- One row per account and currency at the opening date.",
      "- Use signed amounts and factual categories such as cash, liability, receivable, or payable.",
      "- Keep descriptions factual; opening balances are setup facts, not report-period activity.",
      "- Review the emitted opening_balance events before appending.",
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
    "opening-balances": `${sharedHelpers}
const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node mapper.mjs <opening-balances.csv>");
  process.exit(1);
}

const rows = csvRows(inputPath);
const events = rows
  .map((row) => {
    const amount = numberOrNull(row.amount);
    if (amount === null) return null;
    return {
      ts: isoDate(row.ts || row.date || row.as_of),
      source: row.source || "opening_balances_import",
      type: "opening_balance",
      data: {
        amount,
        currency: row.currency || "USD",
        account: row.account || "unspecified",
        category: row.category || "opening_balance",
        description: row.description || "Opening balance",
        confidence: "clear",
        source_doc: inputPath,
        source_row: row.__row,
        provenance: {
          import_kind: "opening-balances",
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
    "opening-balances": `${sharedHelpers}
if len(sys.argv) < 2:
    print("Usage: python3 mapper.py <opening-balances.csv>", file=sys.stderr)
    sys.exit(1)

input_path = sys.argv[1]
events = []

for row in csv_rows(input_path):
    amount = number_or_none(row.get("amount"))
    if amount is None:
        continue
    events.append({
        "ts": iso_date(row.get("ts") or row.get("date") or row.get("as_of")),
        "source": row.get("source") or "opening_balances_import",
        "type": "opening_balance",
        "data": {
            "amount": amount,
            "currency": row.get("currency") or "USD",
            "account": row.get("account") or "unspecified",
            "category": row.get("category") or "opening_balance",
            "description": row.get("description") or "Opening balance",
            "confidence": "clear",
            "source_doc": input_path,
            "source_row": row.get("__row"),
            "provenance": {
                "import_kind": "opening-balances",
                "row_snapshot": row,
            },
        },
    })

for event in events:
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

  if (p[0] === "run") {
    const inputPath = p[1];
    if (!inputPath) {
      console.error("Usage: clawbooks import run <statement.csv> [--statement profile.json] [--out PATH] [--append] [--mappings PATH] [--source NAME] [--currency CUR] [--order auto|newest-first|oldest-first] [--skip-rows N] [--source-doc NAME] [--source-hash HASH] [--recorded-via VALUE] [--apparent-source-entity NAME] [--entity-mismatch true|false] [--transaction-date-col COL] [--posting-date-col COL] [--description-col COL] [--amount-col COL] [--debit-col COL] [--credit-col COL] [--balance-col COL] [--ref-col COL] [--category-col COL] [--type-col COL] [--confidence-col COL] [--classification-basis BASIS] [--save-session]");
      process.exit(1);
    }

    const skipRowsRaw = f["skip-rows"] ?? "0";
    const skipRows = Number(skipRowsRaw);
    if (!Number.isInteger(skipRows) || skipRows < 0) {
      console.error("Invalid --skip-rows. Use a non-negative integer.");
      process.exit(1);
    }

    const parsedCsv = parseCsvFile(resolve(inputPath), f.delimiter, skipRows);
    const columns = resolveImportRunColumns(parsedCsv.headers, f);
    if (!columns.posting_date && !columns.transaction_date) {
      console.error("import run needs a posting date or transaction date column. Use --posting-date-col or --transaction-date-col if auto-detection misses it.");
      process.exit(1);
    }
    if (!columns.amount && !columns.debit && !columns.credit) {
      console.error("import run needs either an amount column or debit/credit columns.");
      process.exit(1);
    }
    if (!columns.description) {
      console.error("import run needs a description column. Use --description-col if auto-detection misses it.");
      process.exit(1);
    }

    const profile = f.statement ? readStatementProfile(resolve(f.statement)) : {};
    const orderFlag = f.order ?? "auto";
    if (!["auto", "newest-first", "oldest-first"].includes(orderFlag)) {
      console.error("Invalid --order. Use auto, newest-first, or oldest-first.");
      process.exit(1);
    }

    const mappingsResolution = resolveVendorMappingsPaths(f.mappings, f.statement, inputPath, params.booksDir);
    const loadedMappings = readVendorMappings(mappingsResolution.used);
    const detectedOrder = detectInputOrder(parsedCsv.rows, columns);
    const targetOrder = orderFlag === "auto"
      ? (profile.newest_first === true ? "newest-first" : "oldest-first")
      : orderFlag;
    const orderedRows = detectedOrder !== "unknown" && detectedOrder !== targetOrder
      ? parsedCsv.rows.slice().reverse()
      : parsedCsv.rows.slice();
    const issues: string[] = [];
    const stagedEvents: Array<Record<string, unknown>> = [];

    for (const row of orderedRows) {
      const amount = inferRowAmount(row, columns);
      if (amount === null) continue;

      const transactionDate = rowValue(row, columns.transaction_date);
      const postingDate = rowValue(row, columns.posting_date);
      const ts = coerceIsoDate(postingDate ?? transactionDate);
      if (!ts) {
        issues.push(`Row ${row.__row}: could not coerce posting/transaction date into ISO form.`);
        continue;
      }

      const description = rowValue(row, columns.description) ?? "";
      const mapping = matchingMapping(description, loadedMappings.mappings);
      const explicitType = rowValue(row, columns.type);
      const explicitCategory = rowValue(row, columns.category);
      const explicitConfidence = rowValue(row, columns.confidence);
      const currency = rowValue(row, columns.currency) ?? f.currency ?? profile.currency ?? "USD";
      const balance = parseSignedNumber(rowValue(row, columns.balance));
      const ref = rowValue(row, columns.ref);
      const type = mapping?.type ?? explicitType ?? (amount >= 0 ? "income" : "expense");
      const category = mapping?.category ?? explicitCategory ?? "uncategorized";
      const confidence = mapping?.confidence ?? explicitConfidence ?? "inferred";

      const sourceDoc = f["source-doc"] ?? resolve(inputPath);
      const sourceHash = f["source-hash"] ?? null;
      stagedEvents.push({
        ts,
        source: f.source ?? profile.source ?? "statement_import",
        type,
        data: {
          amount,
          currency,
          description,
          category,
          confidence,
          ...(ref ? { ref } : {}),
          transaction_date: transactionDate,
          posting_date: postingDate,
          balance,
          source_doc: sourceDoc,
          source_row: row.__row,
          ...(sourceHash ? { source_hash: sourceHash } : {}),
          ...(f["recorded-via"] ? { recorded_via: f["recorded-via"] } : {}),
          provenance: {
            import_kind: "statement-csv",
            runner: "clawbooks import run",
            source_doc: sourceDoc,
            ...(sourceHash ? { source_hash: sourceHash } : {}),
            row_snapshot: row,
          },
        },
      });
    }

    const outPath = resolve(f.out ?? defaultStagedOutPath(inputPath));
    const sourceDoc = f["source-doc"] ?? resolve(inputPath);
    const sourceHash = f["source-hash"] ?? null;
    const stagedText = stagedEvents.map((event) => JSON.stringify(event)).join("\n") + (stagedEvents.length ? "\n" : "");
    writeFileSync(outPath, stagedText, "utf-8");

    let checkReport: Record<string, unknown> | null = null;
    if (f.statement) {
      const dateBasis = (f["date-basis"] ?? profile.date_basis ?? "ledger") as DateBasis;
      if (!["ledger", "transaction", "posting"].includes(dateBasis)) {
        console.error("Invalid --date-basis. Use ledger, transaction, or posting.");
        process.exit(1);
      }
      checkReport = buildImportCheck({
        inputPath: outPath,
        statementProfilePath: resolve(f.statement),
        rawEvents: readEventsFile(outPath),
        ledgerHistoryEvents: existsSync(params.ledgerPath) ? readAll(params.ledgerPath) : [],
        workflow,
        profile,
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
        mapperPath: null,
        recordedBy: f["recorded-by"] ?? null,
        statementStart: f["statement-start"],
        statementEnd: f["statement-end"],
      }) as unknown as Record<string, unknown>;

      if (f["save-session"] === "true") {
        const sessionId = f["session-id"] ?? `import-session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const sessionsDir = sessionsDirFor(params.booksDir, params.ledgerPath);
        mkdirSync(sessionsDir, { recursive: true });
        const sessionPath = resolve(sessionsDir, `${sessionId}.json`);
        const report = checkReport as unknown as ImportSessionRecord & Record<string, unknown>;
        const sessionRecord: ImportSessionRecord = {
          import_session: sessionId,
          session_schema_version: "clawbooks.import-session.v1",
          created_at: new Date().toISOString(),
          recorded_via: "clawbooks import run",
          source_doc: sourceDoc,
          source_hash: sourceHash,
          apparent_source_entity: f["apparent-source-entity"] ?? null,
          entity_mismatch: f["entity-mismatch"] === undefined ? null : f["entity-mismatch"] === "true",
          operator_identity: f["recorded-by"] ?? null,
          notes: f.notes ?? null,
          mapper_path: null,
          scaffold_kind: "statement-csv",
          input_path: resolve(inputPath),
          statement_profile_path: resolve(f.statement),
          status: String(report.status ?? "ok"),
          reporting_mode: String(report.reporting_mode ?? workflow.reporting_mode),
          classification_basis: String(report.classification_basis ?? workflow.classification_basis),
          workflow_acknowledged: workflow.reporting_readiness === "ready",
          workflow_state_path: workflow.state_path,
          program_path: workflow.program.path,
          policy_path: workflow.policy.path,
          program_hash: workflow.program.sha256,
          policy_hash: workflow.policy.sha256,
          date_basis: String(report.date_basis ?? profile.date_basis ?? "ledger"),
          currency: typeof report.currency === "string" ? report.currency : null,
          workflow_state: String(report.workflow_state ?? workflow.workflow_state),
          expected: (report.expected ?? {}) as Record<string, number | string>,
          actual: (report.actual ?? {}) as Record<string, number | string | null>,
          differences: (report.differences ?? {}) as Record<string, number>,
          issue_count: Array.isArray(report.issues) ? report.issues.length : 0,
          issues: Array.isArray(report.issues) ? report.issues as string[] : [],
          source_coverage: (report.source_coverage ?? {}) as Record<string, unknown>,
          input_event_count: Number(report.input_event_count ?? stagedEvents.length),
          filtered_event_count: Number(report.filtered_event_count ?? stagedEvents.length),
          scoped_event_count: Number(((report.source_coverage ?? {}) as Record<string, unknown>).scoped_events ?? 0),
          provenance_coverage: report.provenance_coverage as ReturnType<typeof provenanceCoverage>,
          date_coverage: report.date_coverage as ReturnType<typeof dateCoverage>,
          mapping_diagnostics: (report.mapping_diagnostics ?? {}) as Record<string, unknown>,
          ordering: report.ordering as { filtered: ReturnType<typeof orderingProfile>; scoped: ReturnType<typeof orderingProfile> },
          duplicate_refs: Array.isArray(report.duplicate_refs) ? report.duplicate_refs as string[] : [],
        };
        writeFileSync(sessionPath, JSON.stringify(sessionRecord, null, 2) + "\n", "utf-8");
      }
    }

    let appendResult: Record<string, unknown> | null = null;
    if (f.append === "true") {
      if (checkReport && checkReport.status !== "ok") {
        console.error(`Refusing to append because import check returned status "${String(checkReport.status)}". Review ${outPath} and the reported issues first.`);
        process.exit(1);
      }

      const classificationBasis = f["classification-basis"]
        ?? (loadedMappings.mappings.length > 0 || Boolean(columns.category) || Boolean(columns.type) ? "heuristic_pattern"
          : workflow.reporting_readiness === "ready" ? "policy_guided" : "manual_operator");
      if (!VALID_CLASSIFICATION_BASES.has(classificationBasis)) {
        console.error("Invalid --classification-basis. Use policy_explicit, policy_guided, heuristic_pattern, manual_operator, mixed, or unknown.");
        process.exit(1);
      }
      const reportingMode = deriveReportingMode(workflow.reporting_readiness, classificationBasis);
      const existingLines = existsSync(params.ledgerPath) ? readFileSync(params.ledgerPath, "utf-8").split("\n").filter(Boolean) : [];
      const batch = prepareBatch({ input: stagedText, existingLines });
      if (batch.newLines.length > 0) {
        if (!existsSync(params.ledgerPath)) writeFileSync(params.ledgerPath, "", "utf-8");
        appendFileSync(params.ledgerPath, batch.newLines.join("\n") + "\n", "utf-8");
      }
      appendResult = {
        recorded: batch.recorded,
        skipped: batch.skipped,
        errors: batch.errors,
        warnings: batch.warnings,
        error_messages: batch.errorMessages,
        reporting_mode: reportingMode,
        classification_basis: classificationBasis,
      };
    }

    console.log(JSON.stringify({
      command: "import run",
      workflow,
      reporting_mode: workflow.reporting_mode,
      classification_basis: workflow.classification_basis,
      workflow_warning: workflow.warning,
      status_line: workflow.reporting_mode === "policy_grounded"
        ? "Status: POLICY_GROUNDED"
        : "Status: PROVISIONAL",
      input_path: resolve(inputPath),
      out_path: outPath,
      delimiter: parsedCsv.delimiter === "\t" ? "\\t" : parsedCsv.delimiter,
      row_count: parsedCsv.rows.length,
      emitted_event_count: stagedEvents.length,
      issues,
      source: f.source ?? profile.source ?? "statement_import",
      detected_order: detectedOrder,
      emitted_order: targetOrder,
      columns,
      mappings: {
        path: loadedMappings.path,
        checked_paths: mappingsResolution.checked,
        mapping_count: loadedMappings.mappings.length,
        issues: loadedMappings.issues,
      },
      check: checkReport,
      append: appendResult,
      next_steps: f.append === "true"
        ? ["Run `clawbooks verify`, `clawbooks reconcile`, and `clawbooks review` after append."]
        : [
          `Review ${outPath} before append.`,
          f.statement
            ? "The import check report is included above."
            : "Add --statement profile.json if you want row-count, balance, and ordering checks.",
          `Append with \`clawbooks batch < ${outPath}\` or rerun with \`clawbooks import run ... --append\`.`,
        ],
    }, null, 2));
    return;
  }

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
          source_doc: session.source_doc,
          source_hash: session.source_hash,
          apparent_source_entity: session.apparent_source_entity,
          entity_mismatch: session.entity_mismatch,
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
          { name: "lookup", description: "Explain how a description would match current mappings and history" },
        ],
      }, null, 2));
      return;
    }
    const mappingsResolution = resolveVendorMappingsPaths(f.mappings, undefined, action === "check" ? p[2] : undefined, params.booksDir);
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

    if (action === "lookup") {
      const description = p.slice(2).join(" ").trim();
      if (!description) {
        console.error("Usage: clawbooks import mappings lookup <description> [--mappings PATH] [--source S]");
        process.exit(1);
      }
      const history = f.source ? ledgerEvents.filter((event) => event.source === f.source) : ledgerEvents;
      const normalizedVendor = normalizeVendorText(description);
      const mapping = matchingMapping(description, loadedMappings.mappings);
      const historyGroup = vendorHistory(history)[normalizedVendor];
      const stable = historyGroup ? stableHistorySummary(historyGroup) : null;
      console.log(JSON.stringify({
        command: "import mappings lookup",
        description,
        normalized_vendor: normalizedVendor,
        source: f.source ?? null,
        mappings_path: loadedMappings.path,
        mappings_paths_checked: mappingsResolution.checked,
        matched_mapping: mapping,
        historical_summary: historyGroup ? {
          count: historyGroup.count,
          stable_summary: stable,
          top_description: topEntry(historyGroup.descriptions)?.value ?? null,
          types: historyGroup.types,
          categories: historyGroup.categories,
          sources: historyGroup.sources,
        } : null,
        next_steps: [
          mapping
            ? "The current vendor mappings file already covers this description."
            : "If this description recurs with a stable classification, consider adding it to vendor-mappings.json.",
          "Use `clawbooks import mappings suggest` to surface broader recurring patterns from the ledger.",
        ],
      }, null, 2));
      return;
    }

    console.error("Usage: clawbooks import mappings <suggest|check|lookup> [events.jsonl|description] [--mappings PATH] [--min-occurrences N] [--source S] [--out PATH]");
    process.exit(1);
  }

  if (p[0] === "check") {
    const inputPath = p[1];
    if (!inputPath) {
      console.error("Usage: clawbooks import check <events.jsonl> [--statement profile.json] [--mappings PATH] [--count N] [--debits N] [--credits N] [--opening-balance N] [--closing-balance N] [--date-basis ledger|transaction|posting] [--statement-start YYYY-MM-DD] [--statement-end YYYY-MM-DD] [--currency C] [--source-doc NAME] [--source-hash HASH] [--apparent-source-entity NAME] [--entity-mismatch true|false] [--save-session] [--session-id ID]");
      process.exit(1);
    }

    const profile = f.statement ? readStatementProfile(resolve(f.statement)) : {};
    const dateBasis = (f["date-basis"] ?? profile.date_basis ?? "ledger") as DateBasis;
    if (!["ledger", "transaction", "posting"].includes(dateBasis)) {
      console.error("Invalid --date-basis. Use ledger, transaction, or posting.");
      process.exit(1);
    }

    const rawEvents = readEventsFile(resolve(inputPath));
    const sourceMetadata = firstImportSourceMetadata(rawEvents);
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
        source_doc: f["source-doc"] ?? sourceMetadata.sourceDoc,
        source_hash: f["source-hash"] ?? sourceMetadata.sourceHash,
        apparent_source_entity: f["apparent-source-entity"] ?? null,
        entity_mismatch: f["entity-mismatch"] === undefined ? null : f["entity-mismatch"] === "true",
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
        { name: "opening-balances", description: "Simple opening-balance tables for account/currency starting positions" },
      ],
    }, null, 2));
    return;
  }

  if (p[0] !== "scaffold") {
    console.error("Usage: clawbooks import scaffold <statement-csv|generic-csv|fills-csv|manual-batch|opening-balances> [--out DIR]\n       clawbooks import run <statement.csv> [--statement profile.json] [--out PATH] [--append]\n       clawbooks import mappings <suggest|check|lookup> [events.jsonl|description] [--mappings PATH] [--min-occurrences N] [--source S] [--out PATH]");
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
    ...(kind === "opening-balances" ? [{ path: join(outDir, "opening-balances.csv"), content: openingBalancesTemplate() }] : []),
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
