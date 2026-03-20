import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { positional, flags } from "../cli-helpers.js";
import { round2, sortByTimestamp } from "../reporting.js";
import { filterByDateBasis, type DateBasis } from "../imports.js";
import { readAll, type LedgerEvent } from "../ledger.js";
import { META_TYPES } from "../event-types.js";

type ImportParams = {
  booksDir: string | null;
  ledgerPath: string;
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

type VendorMapping = {
  match: string;
  type?: string;
  category?: string;
  confidence?: string;
  notes?: string;
};

const VALID_KINDS: ScaffoldKind[] = ["statement-csv", "generic-csv", "fills-csv", "manual-batch"];

function descriptionOf(event: LedgerEvent): string | null {
  const value = event.data.description;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeVendorText(value: string): string {
  return value
    .toUpperCase()
    .replace(/\d+/g, "#")
    .replace(/[^A-Z#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMapEntries(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function topEntry(counts: Record<string, number>): { value: string; count: number } | null {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0] ? { value: entries[0][0], count: entries[0][1] } : null;
}

function distinctCount(counts: Record<string, number>): number {
  return Object.keys(counts).length;
}

function matchingMapping(description: string, mappings: VendorMapping[]): VendorMapping | null {
  const normalizedDescription = normalizeVendorText(description);
  const sorted = mappings
    .filter((mapping) => typeof mapping.match === "string" && mapping.match.trim())
    .slice()
    .sort((a, b) => normalizeVendorText(b.match).length - normalizeVendorText(a.match).length);
  return sorted.find((mapping) => normalizedDescription.includes(normalizeVendorText(mapping.match))) ?? null;
}

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

function resolveVendorMappingsPath(explicitPath: string | undefined, statementPath: string | undefined, inputPath: string | undefined): string | null {
  if (explicitPath) return resolve(explicitPath);
  const candidates = [
    statementPath ? join(dirname(resolve(statementPath)), "vendor-mappings.json") : null,
    inputPath ? join(dirname(resolve(inputPath)), "vendor-mappings.json") : null,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function vendorHistory(events: LedgerEvent[]) {
  const groups: Record<string, {
    key: string;
    count: number;
    descriptions: Record<string, number>;
    types: Record<string, number>;
    categories: Record<string, number>;
    confidences: Record<string, number>;
    sources: Record<string, number>;
    ids: string[];
  }> = {};
  for (const event of events) {
    if (META_TYPES.has(event.type)) continue;
    const description = descriptionOf(event);
    if (!description) continue;
    const key = normalizeVendorText(description);
    if (!key) continue;
    const bucket = groups[key] ?? {
      key,
      count: 0,
      descriptions: {},
      types: {},
      categories: {},
      confidences: {},
      sources: {},
      ids: [],
    };
    bucket.count++;
    bucket.descriptions[description] = (bucket.descriptions[description] ?? 0) + 1;
    bucket.types[event.type] = (bucket.types[event.type] ?? 0) + 1;
    const category = typeof event.data.category === "string" ? event.data.category : "";
    if (category) bucket.categories[category] = (bucket.categories[category] ?? 0) + 1;
    const confidence = typeof event.data.confidence === "string" ? event.data.confidence : "";
    if (confidence) bucket.confidences[confidence] = (bucket.confidences[confidence] ?? 0) + 1;
    bucket.sources[event.source] = (bucket.sources[event.source] ?? 0) + 1;
    bucket.ids.push(event.id);
    groups[key] = bucket;
  }
  return groups;
}

function stableHistorySummary(history: ReturnType<typeof vendorHistory>[string]) {
  const type = topEntry(history.types);
  const category = topEntry(history.categories);
  if (!type || !category) return null;
  const stableType = distinctCount(history.types) === 1 && type.count === history.count;
  const stableCategory = distinctCount(history.categories) === 1 && category.count === history.count;
  if (!stableType || !stableCategory) return null;
  const confidence = topEntry(history.confidences);
  const example = topEntry(history.descriptions);
  return {
    type: type.value,
    category: category.value,
    confidence: confidence && distinctCount(history.confidences) === 1 ? confidence.value : undefined,
    example_description: example?.value ?? null,
    count: history.count,
  };
}

function mappingDiagnostics(events: LedgerEvent[], mappings: VendorMapping[], ledgerHistoryEvents: LedgerEvent[]) {
  const describedEvents = events.filter((event) => descriptionOf(event));
  const stagedGroups = vendorHistory(events);
  const historicalGroups = vendorHistory(ledgerHistoryEvents);
  const mappingConflicts: Array<Record<string, unknown>> = [];
  const historyConflicts: Array<Record<string, unknown>> = [];
  const knownHistoryWithoutMapping: Array<Record<string, unknown>> = [];
  const repeatedUnmapped: Array<Record<string, unknown>> = [];
  let matchedEventCount = 0;
  let describedEventCount = 0;

  for (const event of describedEvents) {
    const description = descriptionOf(event)!;
    const key = normalizeVendorText(description);
    const mapping = matchingMapping(description, mappings);
    const historical = historicalGroups[key];
    const stableHistorical = historical ? stableHistorySummary(historical) : null;
    describedEventCount++;

    if (mapping) {
      matchedEventCount++;
      const category = typeof event.data.category === "string" ? event.data.category : null;
      const confidence = typeof event.data.confidence === "string" ? event.data.confidence : null;
      if ((mapping.type && event.type !== mapping.type) || (mapping.category && category && category !== mapping.category) || (mapping.confidence && confidence && confidence !== mapping.confidence)) {
        mappingConflicts.push({
          id: event.id,
          description,
          mapping_match: mapping.match,
          event_type: event.type,
          mapped_type: mapping.type ?? null,
          event_category: category,
          mapped_category: mapping.category ?? null,
          event_confidence: confidence,
          mapped_confidence: mapping.confidence ?? null,
        });
      }
    }

    if (stableHistorical) {
      const category = typeof event.data.category === "string" ? event.data.category : null;
      if (!mapping) {
        knownHistoryWithoutMapping.push({
          normalized_vendor: key,
          example_description: stableHistorical.example_description ?? description,
          stable_count: stableHistorical.count,
          stable_type: stableHistorical.type,
          stable_category: stableHistorical.category,
        });
      }
      if (event.type !== stableHistorical.type || (category && category !== stableHistorical.category)) {
        historyConflicts.push({
          id: event.id,
          description,
          historical_type: stableHistorical.type,
          event_type: event.type,
          historical_category: stableHistorical.category,
          event_category: category,
          historical_count: stableHistorical.count,
        });
      }
    }
  }

  for (const group of Object.values(stagedGroups)) {
    const stable = stableHistorySummary(group);
    const example = topEntry(group.descriptions)?.value ?? null;
    const hasMapping = mappings.some((mapping) => example ? matchingMapping(example, [mapping]) : false);
    if (!hasMapping && group.count >= 2) {
      repeatedUnmapped.push({
        normalized_vendor: group.key,
        count: group.count,
        example_description: example,
        stable_in_staged_file: stable !== null,
      });
    }
  }

  const uniqueKnownHistoryWithoutMapping = Object.values(knownHistoryWithoutMapping.reduce((acc, item) => {
    const key = String(item.normalized_vendor);
    acc[key] = acc[key] ?? item;
    return acc;
  }, {} as Record<string, Record<string, unknown>>));

  return {
    described_event_count: describedEventCount,
    matched_event_count: matchedEventCount,
    unmatched_described_event_count: describedEventCount - matchedEventCount,
    mapping_conflict_count: mappingConflicts.length,
    history_conflict_count: historyConflicts.length,
    repeated_unmapped_vendor_count: repeatedUnmapped.length,
    known_history_without_mapping_count: uniqueKnownHistoryWithoutMapping.length,
    mapping_conflicts: mappingConflicts.slice(0, 10),
    history_conflicts: historyConflicts.slice(0, 10),
    repeated_unmapped_vendors: repeatedUnmapped.slice(0, 10),
    known_history_without_mapping: uniqueKnownHistoryWithoutMapping.slice(0, 10),
  };
}

function suggestMappings(events: LedgerEvent[], existingMappings: VendorMapping[], minOccurrences: number) {
  const groups = vendorHistory(events);
  const suggestions = Object.values(groups)
    .filter((group) => group.count >= minOccurrences)
    .map((group) => {
      const stable = stableHistorySummary(group);
      if (!stable) return null;
      const example = stable.example_description ?? topEntry(group.descriptions)?.value ?? null;
      if (!example) return null;
      const existing = matchingMapping(example, existingMappings);
      return {
        normalized_vendor: group.key,
        count: group.count,
        example_description: example,
        suggested_mapping: {
          match: example,
          type: stable.type,
          category: stable.category,
          ...(stable.confidence ? { confidence: stable.confidence } : {}),
          notes: `Derived from ${group.count} historical ledger event(s) with stable classification.`,
        },
        already_covered: existing !== null,
        existing_match: existing?.match ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.count - a.count || a.normalized_vendor.localeCompare(b.normalized_vendor));

  return {
    total_candidates: suggestions.length,
    uncovered_candidates: suggestions.filter((item) => !item.already_covered).length,
    suggestions,
  };
}

function validateMappingsFile(mappings: VendorMapping[]) {
  const duplicateMatches = Object.entries(countMapEntries(mappings.map((mapping) => normalizeVendorText(mapping.match))))
    .filter(([, count]) => count > 1)
    .map(([match, count]) => ({ normalized_match: match, count }));
  const overlaps: Array<{ match: string; overlaps_with: string }> = [];
  const normalized = mappings.map((mapping) => ({ raw: mapping.match, normalized: normalizeVendorText(mapping.match) }))
    .filter((mapping) => mapping.normalized);
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (normalized[i].normalized === normalized[j].normalized) continue;
      if (normalized[i].normalized.includes(normalized[j].normalized) || normalized[j].normalized.includes(normalized[i].normalized)) {
        overlaps.push({ match: normalized[i].raw, overlaps_with: normalized[j].raw });
      }
    }
  }
  const incompleteMappings = mappings
    .filter((mapping) => !mapping.type || !mapping.category)
    .map((mapping) => ({ match: mapping.match, type: mapping.type ?? null, category: mapping.category ?? null }));
  return {
    mapping_count: mappings.length,
    duplicate_match_count: duplicateMatches.length,
    overlap_count: overlaps.length,
    incomplete_mapping_count: incompleteMappings.length,
    duplicate_matches: duplicateMatches,
    overlapping_matches: overlaps.slice(0, 20),
    incomplete_mappings: incompleteMappings.slice(0, 20),
  };
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
    const mappingsPath = resolveVendorMappingsPath(f.mappings, undefined, p[2]);
    const loadedMappings = readVendorMappings(mappingsPath);
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
    const mappingsPath = resolveVendorMappingsPath(f.mappings, f.statement, inputPath);
    const loadedMappings = readVendorMappings(mappingsPath);
    const ledgerHistoryEvents = existsSync(params.ledgerPath) ? readAll(params.ledgerPath) : [];
    let rawFilteredEvents = rawEvents;
    const currency = f.currency ?? profile.currency;
    if (currency) rawFilteredEvents = rawFilteredEvents.filter((event) => String(event.data.currency) === currency);
    if (profile.source) rawFilteredEvents = rawFilteredEvents.filter((event) => event.source === profile.source);
    const events = sortByTimestamp(rawFilteredEvents);

    const statementStart = f["statement-start"] ?? profile.statement_start;
    const statementEnd = f["statement-end"] ?? profile.statement_end;
    const filteredByBasis = filterByDateBasis(events, {
      after: statementStart ? `${statementStart}T00:00:00.000Z` : undefined,
      before: statementEnd ? `${statementEnd}T23:59:59.999Z` : undefined,
      basis: dateBasis,
    });
    const rawFilteredByBasis = filterByDateBasis(rawFilteredEvents, {
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
    const filteredOrdering = orderingProfile(rawFilteredEvents, dateBasis);
    const scopedOrdering = orderingProfile(rawFilteredByBasis.events, dateBasis);
    const duplicateRefList = duplicateRefs(scopedEvents);
    const mappingsReport = {
      available: loadedMappings.path !== null,
      path: loadedMappings.path,
      file_issues: loadedMappings.issues,
      file_checks: validateMappingsFile(loadedMappings.mappings),
      diagnostics: mappingDiagnostics(rawFilteredEvents, loadedMappings.mappings, ledgerHistoryEvents),
    };

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
    if (profile.newest_first === true && filteredOrdering.order !== "descending") {
      issues.push(`Statement profile says newest_first=true, but the staged file appears ${filteredOrdering.order} by ${dateBasis} date after source/currency filtering.`);
    }
    if (profile.newest_first === false && filteredOrdering.order !== "ascending") {
      issues.push(`Statement profile says newest_first=false, but the staged file appears ${filteredOrdering.order} by ${dateBasis} date after source/currency filtering.`);
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
      input_event_count: rawEvents.length,
      filtered_event_count: events.length,
      event_types: eventCountsByType(scopedEvents),
      provenance_coverage: provenance,
      date_coverage: dates,
      mapping_diagnostics: mappingsReport,
      ordering: {
        filtered: filteredOrdering,
        scoped: scopedOrdering,
      },
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

    if (f["save-session"] === "true") {
      const sessionId = f["session-id"] ?? `import-session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const sessionsDir = params.booksDir && existsSync(params.booksDir)
        ? resolve(params.booksDir, "imports", "sessions")
        : resolve("clawbooks-import-sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const sessionPath = resolve(sessionsDir, `${sessionId}.json`);
      const sessionRecord = {
        import_session: sessionId,
        created_at: new Date().toISOString(),
        recorded_via: "clawbooks import check",
        input_path: resolve(inputPath),
        statement_profile_path: f.statement ? resolve(f.statement) : null,
        status: issues.length === 0 ? "ok" : "mismatch",
        date_basis: dateBasis,
        currency: currency ?? null,
        expected,
        actual,
        differences,
        issue_count: issues.length,
        issues,
        input_event_count: rawEvents.length,
        filtered_event_count: events.length,
        scoped_event_count: scopedEvents.length,
        provenance_coverage: provenance,
        date_coverage: dates,
        mapping_diagnostics: mappingsReport,
        ordering: {
          filtered: filteredOrdering,
          scoped: scopedOrdering,
        },
        duplicate_refs: duplicateRefList,
      };
      writeFileSync(sessionPath, JSON.stringify(sessionRecord, null, 2) + "\n", "utf-8");
      console.error(`Saved import session: ${sessionPath}`);
    }
    return;
  }

  if (f["list-scaffolds"] === "true" || f.list === "true") {
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
