#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import {
  computeId,
  readAll,
  filter,
  append,
  hashLine,
  rewrite,
  latestSnapshot,
  type LedgerEvent,
} from "./ledger.js";

const LEDGER = process.env.CLAWBOOKS_LEDGER ?? "./ledger.jsonl";
const POLICY = process.env.CLAWBOOKS_POLICY ?? "./policy.md";

const OUTFLOW_TYPES = new Set([
  "expense", "tax_payment", "owner_draw", "fee", "dividend",
  "loan_repayment", "refund", "transfer_out", "withdrawal",
]);
const INFLOW_TYPES = new Set([
  "income", "deposit", "equity_injection", "loan_received",
  "transfer_in", "refund_received", "grant",
]);
const META_TYPES = new Set(["snapshot", "reclassify", "opening_balance"]);
const ASSET_EVENT_TYPES = new Set(["disposal", "write_off", "impairment"]);
const TRANSFER_TYPES = new Set(["transfer_in", "transfer_out"]);
const OPERATING_INCOME_TYPES = new Set(["income", "refund_received", "grant"]);
const DOCUMENT_TYPES = new Set(["invoice", "bill"]);

// --- Helpers ---

const SHORT_FLAGS: Record<string, string> = { S: "source", T: "type" };

function isFlag(arg: string): boolean {
  if (arg.startsWith("--")) return true;
  if (arg.length === 2 && arg[0] === "-" && SHORT_FLAGS[arg[1]]) return true;
  return false;
}

function isValue(arg: string): boolean {
  // A value is anything that isn't a flag — negative numbers like -15000 are values
  if (arg.startsWith("--")) return false;
  if (arg.length === 2 && arg[0] === "-" && SHORT_FLAGS[arg[1]]) return false;
  return true;
}

function flags(args: string[]): Record<string, string> {
  const f: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && isValue(args[i + 1])) {
      f[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (args[i].startsWith("--")) {
      f[args[i].slice(2)] = "true";
    } else if (args[i].length === 2 && args[i][0] === "-" && SHORT_FLAGS[args[i][1]]) {
      if (i + 1 < args.length && isValue(args[i + 1])) {
        f[SHORT_FLAGS[args[i][1]]] = args[i + 1];
        i++;
      }
    }
  }
  return f;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (i + 1 < args.length && isValue(args[i + 1])) i++;
      continue;
    }
    if (args[i].length === 2 && args[i][0] === "-" && SHORT_FLAGS[args[i][1]]) {
      if (i + 1 < args.length && isValue(args[i + 1])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function stdin(): Promise<string> {
  return new Promise((resolve) => {
    let d = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => resolve(d));
  });
}

function policyText(): string {
  if (!existsSync(POLICY)) return "No policy.md found.";
  return readFileSync(POLICY, "utf-8");
}

function normalizeDateBoundary(value: string, boundary: "after" | "before"): string {
  if (value.includes("T")) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return boundary === "after"
      ? `${value}-01T00:00:00.000Z`
      : `${value}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return boundary === "after"
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`;
  }
  return value;
}

function parsePeriod(period: string): { after: string; before: string } {
  if (period.includes("/")) {
    const [a, b] = period.split("/");
    return {
      after: normalizeDateBoundary(a, "after"),
      before: normalizeDateBoundary(b, "before"),
    };
  }
  return {
    after: normalizeDateBoundary(period, "after"),
    before: normalizeDateBoundary(period, "before"),
  };
}

function periodFromArgs(args: string[]): { after?: string; before?: string } {
  const f = flags(args);
  const p = positional(args);
  let after: string | undefined = f.after ? normalizeDateBoundary(f.after, "after") : undefined;
  let before: string | undefined = f.before ? normalizeDateBoundary(f.before, "before") : undefined;
  if (p[0]) {
    const period = parsePeriod(p[0]);
    after = after ?? period.after;
    before = before ?? period.before;
  }
  return { after, before };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sortByTimestamp(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
}

function classifyEventSection(event: LedgerEvent): "operating_income" | "operating_expense" | "tax" | "capex" | "owner" | "transfer" | "document" | "other" {
  if (DOCUMENT_TYPES.has(event.type)) return "document";
  if (event.type === "tax_payment") return "tax";
  if (event.type === "owner_draw") return "owner";
  if (TRANSFER_TYPES.has(event.type)) return "transfer";
  if (event.data.capitalize === true) return "capex";
  if (OPERATING_INCOME_TYPES.has(event.type)) return "operating_income";
  if (event.type === "expense" || event.type === "fee") return "operating_expense";
  return "other";
}

function signedAmount(event: LedgerEvent): number | undefined {
  const amount = Number(event.data.amount);
  if (event.data.amount === undefined || isNaN(amount)) return undefined;
  return amount;
}

function absAmount(event: LedgerEvent): number | undefined {
  const amount = signedAmount(event);
  if (amount === undefined) return undefined;
  return Math.abs(amount);
}

function buildReportingSections(events: LedgerEvent[]) {
  const sections: Record<string, Record<string, number>> = {
    operating_income: {},
    operating_expenses: {},
    tax: {},
    capex: {},
    owner_distributions: {},
    internal_transfers: {},
    documents: {},
    other: {},
  };

  const totals = {
    operating_income: 0,
    operating_expenses: 0,
    tax: 0,
    capex: 0,
    owner_distributions: 0,
    internal_transfers_in: 0,
    internal_transfers_out: 0,
    documents_issued: 0,
    documents_received: 0,
    other: 0,
  };

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;
    const amount = signedAmount(e);
    if (amount === undefined) continue;
    const category = String(e.data.category ?? e.type);
    const section = classifyEventSection(e);
    const magnitude = Math.abs(amount);

    if (section === "operating_income") {
      sections.operating_income[category] = round2((sections.operating_income[category] ?? 0) + magnitude);
      totals.operating_income = round2(totals.operating_income + magnitude);
    } else if (section === "operating_expense") {
      sections.operating_expenses[category] = round2((sections.operating_expenses[category] ?? 0) + magnitude);
      totals.operating_expenses = round2(totals.operating_expenses + magnitude);
    } else if (section === "tax") {
      sections.tax[category] = round2((sections.tax[category] ?? 0) + magnitude);
      totals.tax = round2(totals.tax + magnitude);
    } else if (section === "capex") {
      sections.capex[category] = round2((sections.capex[category] ?? 0) + magnitude);
      totals.capex = round2(totals.capex + magnitude);
    } else if (section === "owner") {
      sections.owner_distributions[category] = round2((sections.owner_distributions[category] ?? 0) + magnitude);
      totals.owner_distributions = round2(totals.owner_distributions + magnitude);
    } else if (section === "transfer") {
      sections.internal_transfers[category] = round2((sections.internal_transfers[category] ?? 0) + amount);
      if (amount >= 0) totals.internal_transfers_in = round2(totals.internal_transfers_in + amount);
      else totals.internal_transfers_out = round2(totals.internal_transfers_out + magnitude);
    } else if (section === "document") {
      sections.documents[category] = round2((sections.documents[category] ?? 0) + amount);
      if (amount >= 0) totals.documents_issued = round2(totals.documents_issued + amount);
      else totals.documents_received = round2(totals.documents_received + magnitude);
    } else {
      sections.other[category] = round2((sections.other[category] ?? 0) + amount);
      totals.other = round2(totals.other + amount);
    }
  }

  return {
    sections,
    totals,
    movement_summary: {
      operating_inflows: round2(totals.operating_income),
      operating_outflows: round2(totals.operating_expenses),
      operating_net: round2(totals.operating_income - totals.operating_expenses),
      tax_outflows: round2(totals.tax),
      documents_issued: round2(totals.documents_issued),
      documents_received: round2(totals.documents_received),
    },
  };
}

function topCategoryEntries(section: Record<string, number>, limit = 5): Array<{ category: string; total: number }> {
  return Object.entries(section)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, total]) => ({ category, total }));
}

function buildCompactContextSummary(summary: ReturnType<typeof buildContextSummary>) {
  return {
    counts: {
      events: summary.event_count,
      non_meta_events: summary.non_meta_event_count,
      review_items: summary.review.needs_review,
    },
    movement_summary: summary.movement_summary,
    cash_flow: summary.cash_flow,
    report_totals: summary.report_totals,
    top_operating_expenses: topCategoryEntries(summary.report_sections.operating_expenses),
    top_capex: topCategoryEntries(summary.report_sections.capex, 3),
    top_transfers: topCategoryEntries(summary.report_sections.internal_transfers, 3),
    review: summary.review,
  };
}

function buildReclassifyMap(events: LedgerEvent[]): Record<string, string> {
  const reclassifyMap: Record<string, string> = {};
  for (const e of events) {
    if (e.type === "reclassify" && e.data.original_id && e.data.new_category) {
      reclassifyMap[String(e.data.original_id)] = String(e.data.new_category);
    }
  }
  return reclassifyMap;
}

function reviewCounts(events: LedgerEvent[], all: LedgerEvent[]): Record<string, number> {
  const reclassified = new Set(
    all.filter((e) => e.type === "reclassify").map((e) => String(e.data.original_id)),
  );
  const counts = { unclear: 0, inferred: 0, unset: 0, clear: 0 };

  for (const e of events) {
    if (e.type === "reclassify" || e.type === "snapshot" || reclassified.has(e.id)) continue;
    const confidence = String(e.data.confidence ?? "unset");
    if (confidence === "clear") counts.clear++;
    else if (confidence === "unclear") counts.unclear++;
    else if (confidence === "inferred") counts.inferred++;
    else counts.unset++;
  }

  return counts;
}

function buildContextSummary(events: LedgerEvent[], all: LedgerEvent[]) {
  const reclassifyMap = buildReclassifyMap(all);
  const byType: Record<string, { count: number; total: number }> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  const eventTypes = new Set<string>();
  const sources = new Set<string>();
  const currencies = new Set<string>();
  let inflows = 0;
  let outflows = 0;
  let nonMetaEvents = 0;
  let rawReclassifications = 0;
  const reporting = buildReportingSections(events);

  for (const e of events) {
    eventTypes.add(e.type);
    sources.add(e.source);
    if (e.type === "reclassify") rawReclassifications++;
    if (META_TYPES.has(e.type)) continue;

    nonMetaEvents++;
    const amount = Number(e.data.amount);
    const currency = String(e.data.currency ?? "UNKNOWN");
    const category = reclassifyMap[e.id] ?? String(e.data.category ?? e.type);
    currencies.add(currency);

    if (!byType[e.type]) byType[e.type] = { count: 0, total: 0 };
    byType[e.type].count++;

    if (!bySource[e.source]) bySource[e.source] = { count: 0, total: 0 };
    bySource[e.source].count++;

    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++;

    if (!byCategory[category]) byCategory[category] = { count: 0, total: 0 };
    byCategory[category].count++;

    if (isNaN(amount)) continue;

    byType[e.type].total = round2(byType[e.type].total + amount);
    bySource[e.source].total = round2(bySource[e.source].total + amount);
    byCurrency[currency].total = round2(byCurrency[currency].total + amount);
    byCategory[category].total = round2(byCategory[category].total + amount);

    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  const confidence = reviewCounts(events, all);
  const needsReview = confidence.unclear + confidence.inferred + confidence.unset;
  const reclassifiedEventCount = events.filter((e) => reclassifyMap[e.id] !== undefined).length;

  return {
    event_count: events.length,
    non_meta_event_count: nonMetaEvents,
    event_types: [...eventTypes].sort(),
    sources: [...sources].sort(),
    currencies: [...currencies].sort(),
    by_type: byType,
    by_source: bySource,
    by_currency: byCurrency,
    by_category: byCategory,
    cash_flow: {
      inflows: round2(inflows),
      outflows: round2(outflows),
      net: round2(inflows + outflows),
    },
    reclassifications: {
      raw_events_in_window: rawReclassifications,
      applied_to_events_in_window: reclassifiedEventCount,
    },
    review: {
      needs_review: needsReview,
      by_confidence: confidence,
    },
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  };
}

function enforceSign(type: string, data: Record<string, unknown>): void {
  if (data.amount === undefined) return;
  const amount = Number(data.amount);
  if (isNaN(amount)) return;
  if (DOCUMENT_TYPES.has(type)) {
    // Sign based on direction: issued = positive (owed to you), received = negative (you owe)
    if (data.direction === "issued") {
      data.amount = Math.abs(amount);
    } else if (data.direction === "received") {
      data.amount = -Math.abs(amount);
    }
    // If direction is absent, don't enforce sign — agent classifies per policy
    return;
  }
  if (OUTFLOW_TYPES.has(type)) {
    data.amount = -Math.abs(amount);
  } else if (INFLOW_TYPES.has(type)) {
    data.amount = Math.abs(amount);
  } else if (!META_TYPES.has(type) && !ASSET_EVENT_TYPES.has(type)) {
    // Unknown type — preserve the sign the caller provided, but warn
    console.error(`Warning: unknown type "${type}" — sign not enforced. Verify the amount sign is correct.`);
  }
}

// --- Commands ---

function cmdRecord(args: string[]) {
  const json = positional(args)[0];
  if (!json) {
    console.error("Usage: clawbooks record '<json>'");
    console.error(`  clawbooks record '{"source":"bank","type":"expense","data":{"amount":100,"currency":"USD","description":"test"}}'`);
    process.exit(1);
  }

  let parsed: { source: string; type: string; data: Record<string, unknown>; ts?: string };
  try { parsed = JSON.parse(json); } catch { console.error("Invalid JSON."); process.exit(1); }

  if (!parsed.source || !parsed.type || !parsed.data) {
    console.error("Required fields: source, type, data"); process.exit(1);
  }

  enforceSign(parsed.type, parsed.data);

  const ts = parsed.ts ?? new Date().toISOString();
  const event: LedgerEvent = {
    ts,
    source: parsed.source,
    type: parsed.type,
    data: parsed.data,
    id: computeId(parsed.data, { source: parsed.source, type: parsed.type, ts }),
    prev: "",
  };

  try {
    if (append(LEDGER, event)) {
      console.log(JSON.stringify({ recorded: true, id: event.id }));
    } else {
      console.log(JSON.stringify({ recorded: false, reason: "duplicate", id: event.id }));
    }
  } catch (err) {
    console.error(String((err as Error).message));
    process.exit(1);
  }
}

async function cmdBatch() {
  const input = await stdin();
  if (!input.trim()) {
    console.error("Pipe JSONL to stdin. Each line: {source, type, data, ts?}");
    console.error("  cat events.jsonl | clawbooks batch");
    process.exit(1);
  }

  let recorded = 0, skipped = 0, errors = 0;
  const errorMessages: string[] = [];

  // Read ledger once, keep in-memory ID set + running prev hash
  if (!existsSync(LEDGER)) writeFileSync(LEDGER, "", "utf-8");
  const existingLines = readFileSync(LEDGER, "utf-8").split("\n").filter(Boolean);
  const existingIds = new Set(existingLines.map((l) => (JSON.parse(l) as LedgerEvent).id));
  let prevHash = existingLines.length > 0 ? hashLine(existingLines[existingLines.length - 1]) : "genesis";
  const newLines: string[] = [];

  for (const line of input.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const source = parsed.source ?? "import";
      const type = parsed.type ?? "unknown";
      const data = parsed.data ?? parsed;

      enforceSign(type, data);

      const ts = parsed.ts ?? new Date().toISOString();
      const event: LedgerEvent = {
        ts,
        source,
        type,
        data,
        id: computeId(data, { source, type, ts }),
        prev: "",
      };

      if (existingIds.has(event.id)) {
        skipped++;
        continue;
      }

      if (!META_TYPES.has(event.type) && event.data.currency === undefined) {
        throw new Error(`Event missing data.currency (type: ${event.type}, id: ${event.id})`);
      }

      event.prev = prevHash;
      const jsonLine = JSON.stringify(event);
      prevHash = hashLine(jsonLine);
      newLines.push(jsonLine);
      existingIds.add(event.id);
      recorded++;
    } catch (err) {
      errors++;
      errorMessages.push(String((err as Error).message));
    }
  }

  if (newLines.length > 0) {
    appendFileSync(LEDGER, newLines.join("\n") + "\n", "utf-8");
  }

  if (errorMessages.length > 0) {
    console.error(errorMessages.join("\n"));
  }

  console.log(JSON.stringify({ recorded, skipped, errors }));
}

function cmdLog(args: string[]) {
  const f = flags(args);
  const all = readAll(LEDGER);
  const events = filter(all, {
    source: f.source,
    type: f.type,
    after: f.after,
    before: f.before,
    last: f.last ? parseInt(f.last) : 20,
  });

  for (const e of events) console.log(JSON.stringify(e));
}

function cmdContext(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(LEDGER);
  const verbose = f.verbose === "true";
  const includePolicy = f["include-policy"] === "true";

  // Find latest snapshot before the window
  const snapshot = latestSnapshot(all, after);
  const effectiveAfter = snapshot?.ts ?? after;
  const events = sortByTimestamp(filter(all, { after: effectiveAfter, before }).filter((e) => e.type !== "snapshot"));
  const summary = buildContextSummary(events, all);
  const summaryOut = verbose ? summary : buildCompactContextSummary(summary);
  const metadata = {
    schema_version: "clawbooks.context.v2",
    generated_at: new Date().toISOString(),
    ledger_path: LEDGER,
    policy_path: POLICY,
    requested_window: {
      after: after ?? "all",
      before: before ?? "now",
    },
    effective_window: {
      after: effectiveAfter ?? "all",
      before: before ?? "now",
    },
    snapshot: snapshot ? {
      used: true,
      ts: snapshot.ts,
      source: snapshot.source,
      id: snapshot.id,
      event_count: Number(snapshot.data.event_count ?? 0),
    } : {
      used: false,
    },
    event_count: events.length,
    sources: summary.sources,
    event_types: summary.event_types,
    currencies: summary.currencies,
  };

  // Output structured context for the agent
  console.log(`<context schema="clawbooks.context.v2">`);
  console.log(`<metadata>`);
  console.log(JSON.stringify(metadata, null, 2));
  console.log(`</metadata>`);
  console.log();

  console.log(`<instructions>`);
  console.log(`Read the policy first.`);
  console.log(`Use the policy path in metadata or run \`clawbooks policy\` to inspect the full policy text.`);
  if (snapshot) {
    console.log(`Treat the snapshot as the starting state up to its as_of timestamp.`);
    console.log(`Apply the events block on top of that snapshot to answer the user's question.`);
  } else {
    console.log(`No snapshot is present for this window, so reason directly from the events block.`);
  }
  console.log(`Prefer the summary block for orientation, and use the events block for transaction-level reasoning.`);
  if (!verbose) {
    console.log(`This is the compact context view. Use --verbose to print the full raw event payloads.`);
  }
  console.log(`Reclassify events are append-only corrections; use them when interpreting categories.`);
  console.log(`Amounts are signed: inflows are positive, outflows are negative for known flow types. Document types (invoice, bill) are signed by direction.`);
  console.log(`</instructions>`);
  console.log();

  if (includePolicy) {
    console.log(`<policy>`);
    console.log(policyText());
    console.log(`</policy>`);
    console.log();
  }

  console.log(`<summary>`);
  console.log(JSON.stringify(summaryOut, null, 2));
  console.log(`</summary>`);
  console.log();

  if (snapshot) {
    console.log(`<snapshot as_of="${snapshot.ts}">`);
    console.log(JSON.stringify(snapshot.data, null, 2));
    console.log(`</snapshot>`);
    console.log();
  }

  console.log(`<events count="${events.length}" after="${effectiveAfter ?? "all"}" before="${before ?? "now"}" verbosity="${verbose ? "full" : "compact"}">`);
  for (const e of events) {
    if (verbose) {
      console.log(JSON.stringify(e));
      continue;
    }
    console.log(JSON.stringify({
      ts: e.ts,
      source: e.source,
      type: e.type,
      category: String(e.data.category ?? e.type),
      description: String(e.data.description ?? ""),
      amount: e.data.amount,
      currency: String(e.data.currency ?? ""),
      confidence: String(e.data.confidence ?? ""),
      id: e.id,
    }));
  }
  console.log(`</events>`);
  console.log(`</context>`);
}

function cmdPolicy(args: string[]) {
  const f = flags(args);
  if (f.path === "true") {
    console.log(POLICY);
    return;
  }
  console.log(policyText());
}

function cmdStats() {
  const all = readAll(LEDGER);
  if (all.length === 0) {
    console.log("Empty ledger.");
    return;
  }

  const sources = new Set(all.map((e) => e.source));
  const types = new Set(all.map((e) => e.type));
  const chronological = sortByTimestamp(all);
  const first = chronological[0].ts;
  const last = chronological[chronological.length - 1].ts;
  const snapshots = all.filter((e) => e.type === "snapshot").length;

  console.log(JSON.stringify({
    events: all.length,
    snapshots,
    sources: [...sources],
    types: [...types],
    first,
    last,
  }, null, 2));
}

function cmdVerify(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(LEDGER);
  const isFiltered = !!(f.source || after || before);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  const byType: Record<string, { count: number; total: number }> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; debits: number; credits: number }> = {};
  const issues: string[] = [];
  let debits = 0;
  let credits = 0;

  for (const e of events) {
    if (!byType[e.type]) byType[e.type] = { count: 0, total: 0 };
    byType[e.type].count++;

    if (!bySource[e.source]) bySource[e.source] = { count: 0, total: 0 };
    bySource[e.source].count++;

    const amount = Number(e.data.amount);
    if (e.data.amount !== undefined && isNaN(amount)) {
      issues.push(`Event ${e.id}: non-numeric amount "${e.data.amount}"`);
    } else if (e.data.amount !== undefined) {
      byType[e.type].total = round2(byType[e.type].total + amount);
      bySource[e.source].total = round2(bySource[e.source].total + amount);

      if (amount < 0) {
        debits = round2(debits + amount);
      } else {
        credits = round2(credits + amount);
      }

      // by_currency
      const currency = String(e.data.currency ?? "UNKNOWN");
      if (!byCurrency[currency]) byCurrency[currency] = { count: 0, debits: 0, credits: 0 };
      byCurrency[currency].count++;
      if (amount < 0) {
        byCurrency[currency].debits = round2(byCurrency[currency].debits + amount);
      } else {
        byCurrency[currency].credits = round2(byCurrency[currency].credits + amount);
      }
    }

    // Sign consistency checks
    if (e.data.amount !== undefined && !isNaN(amount)) {
      if (OUTFLOW_TYPES.has(e.type) && amount > 0) {
        issues.push(`Event ${e.id}: outflow type "${e.type}" has positive amount ${amount}`);
      } else if (INFLOW_TYPES.has(e.type) && amount < 0) {
        issues.push(`Event ${e.id}: inflow type "${e.type}" has negative amount ${amount}`);
      } else if (DOCUMENT_TYPES.has(e.type)) {
        if (e.data.direction === "issued" && amount < 0) {
          issues.push(`Event ${e.id}: document type "${e.type}" with direction "issued" has negative amount ${amount}`);
        } else if (e.data.direction === "received" && amount > 0) {
          issues.push(`Event ${e.id}: document type "${e.type}" with direction "received" has positive amount ${amount}`);
        }
      }
    }

    if (!e.source) issues.push(`Event ${e.id}: missing source`);
    if (!e.type) issues.push(`Event ${e.id}: missing type`);
    if (!e.data || typeof e.data !== "object") issues.push(`Event ${e.id}: missing or invalid data`);
  }

  // Chain verification (only on unfiltered full ledger)
  let chain_valid = true;
  if (!isFiltered) {
    for (let i = 0; i < all.length; i++) {
      if (i === 0) {
        if (all[i].prev !== "genesis") {
          issues.push(`Event ${all[i].id}: first event prev should be "genesis", got "${all[i].prev}"`);
          chain_valid = false;
        }
      } else {
        const prevEvent = { ...all[i - 1] };
        const prevLine = JSON.stringify(prevEvent);
        const expectedPrev = hashLine(prevLine);
        if (all[i].prev !== expectedPrev) {
          issues.push(`Event ${all[i].id}: chain break at index ${i} (expected prev ${expectedPrev}, got ${all[i].prev})`);
          chain_valid = false;
        }
      }
    }
  }

  // Balance cross-check
  let balanceCheck: {
    expected: number;
    actual: number;
    difference: number;
    matches: boolean;
    opening_balance?: number;
    net_movement?: number;
    closing_balance?: number;
  } | undefined;
  if (f.balance !== undefined) {
    const expectedBalance = parseFloat(f.balance);
    const openingBalance = f["opening-balance"] !== undefined ? parseFloat(f["opening-balance"]) : 0;
    let movement = 0;
    for (const e of events) {
      if (META_TYPES.has(e.type)) continue;
      const amount = Number(e.data.amount);
      if (isNaN(amount)) continue;
      if (f.currency && String(e.data.currency) !== f.currency) continue;
      movement = round2(movement + amount);
    }
    const actual = round2(openingBalance + movement);
    const difference = round2(actual - expectedBalance);
    const matches = Math.abs(difference) < 0.01;
    balanceCheck = { expected: expectedBalance, actual, difference, matches };
    if (!matches) {
      issues.push(`Balance mismatch: expected ${expectedBalance}, got ${actual} (difference: ${difference})`);
    }
    if (f["opening-balance"] !== undefined) {
      Object.assign(balanceCheck, {
        opening_balance: openingBalance,
        net_movement: movement,
        closing_balance: actual,
      });
    }
  }

  // Duplicate detection — group non-meta, non-asset events by source|date|amount|description
  const dupGroups: Record<string, string[]> = {};
  for (const e of events) {
    if (META_TYPES.has(e.type) || ASSET_EVENT_TYPES.has(e.type)) continue;
    const key = `${e.source}|${e.ts.slice(0, 10)}|${e.data.amount}|${e.data.description ?? ""}`;
    if (!dupGroups[key]) dupGroups[key] = [];
    dupGroups[key].push(e.id);
  }
  const potentialDuplicates = Object.values(dupGroups).filter((ids) => ids.length > 1);

  const hash = createHash("sha256")
    .update(events.map((e) => e.id).join(","))
    .digest("hex");

  console.log(JSON.stringify({
    event_count: events.length,
    by_type: byType,
    by_source: bySource,
    by_currency: byCurrency,
    debits: round2(debits),
    credits: round2(credits),
    ...(isFiltered ? {} : { chain_valid }),
    ...(balanceCheck ? { balance_check: balanceCheck } : {}),
    ...(potentialDuplicates.length > 0 ? { potential_duplicates: potentialDuplicates } : {}),
    hash,
    issues,
  }, null, 2));
}

function cmdReconcile(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);

  if (!f.source) {
    console.error("Usage: clawbooks reconcile [period] --source S [--count N] [--debits N] [--credits N] [--currency C]");
    process.exit(1);
  }

  const all = readAll(LEDGER);
  let events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  // Filter by currency if specified
  if (f.currency) {
    events = events.filter((e) => String(e.data.currency) === f.currency);
  }

  let actualDebits = 0;
  let actualCredits = 0;
  for (const e of events) {
    const amount = Number(e.data.amount);
    if (!isNaN(amount)) {
      if (amount < 0) {
        actualDebits = round2(actualDebits + amount);
      } else {
        actualCredits = round2(actualCredits + amount);
      }
    }
  }

  const expected: Record<string, number> = {};
  const actual: Record<string, number> = {};
  const differences: Record<string, number> = {};
  const issues: string[] = [];
  let status = "NO_EXPECTATIONS";

  if (f.count !== undefined) {
    expected.count = parseInt(f.count);
    actual.count = events.length;
    differences.count = actual.count - expected.count;
    if (differences.count !== 0) issues.push(`Count mismatch: expected ${expected.count}, got ${actual.count}`);
    status = "RECONCILED";
  }

  if (f.debits !== undefined) {
    expected.debits = parseFloat(f.debits);
    actual.debits = actualDebits;
    differences.debits = round2(actual.debits - expected.debits);
    if (Math.abs(differences.debits) > 0.01) issues.push(`Debits mismatch: expected ${expected.debits}, got ${actual.debits}`);
    status = "RECONCILED";
  }

  if (f.credits !== undefined) {
    expected.credits = parseFloat(f.credits);
    actual.credits = actualCredits;
    differences.credits = round2(actual.credits - expected.credits);
    if (Math.abs(differences.credits) > 0.01) issues.push(`Credits mismatch: expected ${expected.credits}, got ${actual.credits}`);
    status = "RECONCILED";
  }

  if (issues.length > 0) status = "MISMATCH";

  // Gap detection
  let gaps: string[] | undefined;
  if (f.gaps === "true") {
    gaps = [];
    const dates = events
      .filter((e) => !META_TYPES.has(e.type))
      .map((e) => e.ts.slice(0, 10))
      .filter((d, i, a) => a.indexOf(d) === i)
      .sort();
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        gaps.push(`${dates[i - 1]} → ${dates[i]} (${diffDays} days)`);
      }
    }
  }

  console.log(JSON.stringify({
    expected, actual, differences, status, issues,
    ...(gaps ? { gaps } : {}),
  }, null, 2));
}

function cmdReview(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(LEDGER);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  // Find all reclassified event IDs (search full ledger)
  const reclassified = new Set(
    all.filter((e) => e.type === "reclassify").map((e) => String(e.data.original_id)),
  );

  // Filter out snapshots, reclassify events, and already-handled events
  const reviewable = events
    .filter((e) => e.type !== "reclassify" && e.type !== "snapshot")
    .filter((e) => !reclassified.has(e.id));

  const tiers: Record<string, LedgerEvent[]> = { unclear: [], inferred: [], unset: [] };

  for (const e of reviewable) {
    const confidence = String(e.data.confidence ?? "unset");
    if (confidence === "clear") continue;
    if (confidence === "unclear") tiers.unclear.push(e);
    else if (confidence === "inferred") tiers.inferred.push(e);
    else tiers.unset.push(e);
  }

  const needs_review = tiers.unclear.length + tiers.inferred.length + tiers.unset.length;

  console.log(JSON.stringify({
    needs_review,
    by_confidence: {
      unclear: tiers.unclear.length,
      inferred: tiers.inferred.length,
      unset: tiers.unset.length,
    },
    items: [...tiers.unclear, ...tiers.inferred, ...tiers.unset],
  }, null, 2));
}

function cmdSummary(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(LEDGER);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  // Build reclassification map (search full ledger)
  const reclassifyMap: Record<string, string> = {};
  for (const e of all) {
    if (e.type === "reclassify" && e.data.original_id && e.data.new_category) {
      reclassifyMap[String(e.data.original_id)] = String(e.data.new_category);
    }
  }

  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { type: string; count: number; total: number }> = {};
  const byMonth: Record<string, Record<string, number>> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  let inflows = 0;
  let outflows = 0;
  const reporting = buildReportingSections(events);

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;

    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;

    const type = e.type;
    const category = reclassifyMap[e.id] ?? String(e.data.category ?? e.type);
    const month = e.ts.slice(0, 7);
    const currency = String(e.data.currency ?? "UNKNOWN");

    // by_type
    if (!byType[type]) byType[type] = { count: 0, total: 0 };
    byType[type].count++;
    byType[type].total = round2(byType[type].total + amount);

    // by_category
    if (!byCategory[category]) byCategory[category] = { type, count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total = round2(byCategory[category].total + amount);

    // by_month
    if (!byMonth[month]) byMonth[month] = {};
    byMonth[month][type] = round2((byMonth[month][type] ?? 0) + amount);

    // by_source
    if (!bySource[e.source]) bySource[e.source] = { count: 0, total: 0 };
    bySource[e.source].count++;
    bySource[e.source].total = round2(bySource[e.source].total + amount);

    // by_currency
    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++;
    byCurrency[currency].total = round2(byCurrency[currency].total + amount);

    // cash_flow (sign-based)
    if (amount > 0) {
      inflows = round2(inflows + amount);
    } else {
      outflows = round2(outflows + amount);
    }
  }

  console.log(JSON.stringify({
    by_type: byType,
    by_category: byCategory,
    by_month: byMonth,
    by_source: bySource,
    by_currency: byCurrency,
    cash_flow: {
      inflows: round2(inflows),
      outflows: round2(outflows),
      net: round2(inflows + outflows),
    },
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  }, null, 2));
}

function cmdSnapshot(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(LEDGER);
  const events = sortByTimestamp(filter(all, { after, before }));

  // Balances by currency
  const balances: Record<string, number> = {};
  // Totals by category
  const byCategory: Record<string, number> = {};
  let eventCount = 0;
  const reporting = buildReportingSections(events);

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;

    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;

    eventCount++;
    const currency = String(e.data.currency ?? "UNKNOWN");
    const category = String(e.data.category ?? e.type);

    // Balances
    balances[currency] = round2((balances[currency] ?? 0) + amount);

    // By category
    byCategory[category] = round2((byCategory[category] ?? 0) + amount);

  }

  const snapshotData = {
    period: { after: after ?? "all", before: before ?? "now" },
    event_count: eventCount,
    balances,
    by_category: byCategory,
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  };

  if (f.save === "true") {
    const ts = new Date().toISOString();
    const event: LedgerEvent = {
      ts,
      source: "clawbooks:snapshot",
      type: "snapshot",
      data: snapshotData,
      id: computeId(snapshotData as unknown as Record<string, unknown>, {
        source: "clawbooks:snapshot",
        type: "snapshot",
        ts,
      }),
      prev: "",
    };

    if (append(LEDGER, event)) {
      console.log(JSON.stringify({ saved: true, id: event.id, snapshot: snapshotData }, null, 2));
    } else {
      console.log(JSON.stringify({ saved: false, reason: "duplicate", snapshot: snapshotData }, null, 2));
    }
  } else {
    console.log(JSON.stringify(snapshotData, null, 2));
  }
}

function cmdAssets(args: string[]) {
  const f = flags(args);
  const all = readAll(LEDGER);
  const categoryFilter = f.category;
  const defaultLife = parseInt(f.life ?? "36");
  const asOf = f["as-of"] ?? new Date().toISOString();

  // Index asset lifecycle events by data.asset_id
  const disposals: Record<string, LedgerEvent> = {};
  const writeOffs: Record<string, LedgerEvent> = {};
  const impairments: Record<string, LedgerEvent[]> = {};

  for (const e of all) {
    const assetId = String(e.data.asset_id ?? "");
    if (!assetId) continue;
    if (e.type === "disposal") disposals[assetId] = e;
    else if (e.type === "write_off") writeOffs[assetId] = e;
    else if (e.type === "impairment") {
      if (!impairments[assetId]) impairments[assetId] = [];
      impairments[assetId].push(e);
    }
  }

  interface AssetRecord {
    id: string;
    date: string;
    description: string;
    category: string;
    cost: number;
    currency: string;
    useful_life_months: number;
    monthly_depreciation: number;
    months_elapsed: number;
    accumulated_depreciation: number;
    impairment_total: number;
    net_book_value: number;
    fully_depreciated: boolean;
  }

  const active: AssetRecord[] = [];
  const disposed: (AssetRecord & { proceeds: number; gain_loss: number })[] = [];
  const writtenOff: (AssetRecord & { loss: number })[] = [];

  for (const e of all) {
    if (e.data.capitalize !== true) continue;
    const cat = String(e.data.category ?? "");
    if (categoryFilter && cat !== categoryFilter) continue;

    const amount = Math.abs(Number(e.data.amount));
    if (isNaN(amount)) continue;

    const currency = String(e.data.currency ?? "UNKNOWN");
    const description = String(e.data.description ?? "");
    const lifeMonths = Number(e.data.useful_life_months) || defaultLife;

    // Compute depreciation
    const purchaseDate = new Date(e.ts);
    const reportDate = new Date(asOf);
    const monthsElapsed = Math.max(0,
      (reportDate.getFullYear() - purchaseDate.getFullYear()) * 12 +
      (reportDate.getMonth() - purchaseDate.getMonth()),
    );
    const monthlyDep = round2(amount / lifeMonths);
    const accDep = round2(Math.min(amount, monthlyDep * monthsElapsed));

    // Apply impairments
    let impairmentTotal = 0;
    if (impairments[e.id]) {
      for (const imp of impairments[e.id]) {
        impairmentTotal = round2(impairmentTotal + Math.abs(Number(imp.data.impairment_amount) || 0));
      }
    }

    const nbv = round2(Math.max(0, amount - accDep - impairmentTotal));

    const record: AssetRecord = {
      id: e.id,
      date: e.ts.slice(0, 10),
      description,
      category: cat,
      cost: amount,
      currency,
      useful_life_months: lifeMonths,
      monthly_depreciation: monthlyDep,
      months_elapsed: Math.min(monthsElapsed, lifeMonths),
      accumulated_depreciation: accDep,
      impairment_total: impairmentTotal,
      net_book_value: nbv,
      fully_depreciated: monthsElapsed >= lifeMonths,
    };

    if (disposals[e.id]) {
      const proceeds = Number(disposals[e.id].data.proceeds) || 0;
      disposed.push({ ...record, net_book_value: 0, proceeds, gain_loss: round2(proceeds - nbv) });
    } else if (writeOffs[e.id]) {
      writtenOff.push({ ...record, net_book_value: 0, loss: round2(-nbv) });
    } else {
      active.push(record);
    }
  }

  const totalCost = round2(active.reduce((s, a) => s + a.cost, 0));
  const totalAccDep = round2(active.reduce((s, a) => s + a.accumulated_depreciation, 0));
  const totalNBV = round2(active.reduce((s, a) => s + a.net_book_value, 0));

  console.log(JSON.stringify({
    as_of: asOf.slice(0, 10),
    category: categoryFilter ?? "all",
    useful_life_months_default: defaultLife,
    active: {
      count: active.length,
      total_cost: totalCost,
      accumulated_depreciation: totalAccDep,
      net_book_value: totalNBV,
      assets: active,
    },
    disposed: {
      count: disposed.length,
      assets: disposed,
    },
    written_off: {
      count: writtenOff.length,
      assets: writtenOff,
    },
  }, null, 2));
}

function cmdCompact(args: string[]) {
  const f = flags(args);
  const { before } = periodFromArgs(args);

  if (!before) {
    console.error("Usage: clawbooks compact <period> or --before <date>");
    console.error("  Moves events before the cutoff to an archive file and saves a snapshot.");
    console.error("  Example: clawbooks compact 2025-12");
    process.exit(1);
  }

  const all = readAll(LEDGER);
  const keep = sortByTimestamp(all.filter((e) => e.ts > before));
  const archive = sortByTimestamp(all.filter((e) => e.ts <= before));

  if (archive.length === 0) {
    console.log(JSON.stringify({ compacted: false, reason: "no events before cutoff" }));
    return;
  }

  // Build snapshot of archived events
  const balances: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let eventCount = 0;
  const reporting = buildReportingSections(archive);

  for (const e of archive) {
    if (META_TYPES.has(e.type)) continue;
    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;
    eventCount++;
    const currency = String(e.data.currency ?? "UNKNOWN");
    const category = String(e.data.category ?? e.type);
    balances[currency] = round2((balances[currency] ?? 0) + amount);
    byCategory[category] = round2((byCategory[category] ?? 0) + amount);
  }

  const snapshotData = {
    period: { after: "all", before },
    event_count: eventCount,
    balances,
    by_category: byCategory,
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
    compacted_from: archive.length,
  };

  const ts = before;
  const snapshotEvent: LedgerEvent = {
    ts,
    source: "clawbooks:compact",
    type: "snapshot",
    data: snapshotData,
    id: computeId(snapshotData as unknown as Record<string, unknown>, {
      source: "clawbooks:compact", type: "snapshot", ts,
    }),
    prev: "",
  };

  // Write archive
  const archivePath = f.archive ?? LEDGER.replace(".jsonl", `-archive-${before.slice(0, 10)}.jsonl`);
  rewrite(archivePath, archive);

  // Rewrite main ledger: snapshot + remaining events
  rewrite(LEDGER, [snapshotEvent, ...keep]);

  console.log(JSON.stringify({
    compacted: true,
    archived: archive.length,
    archive_path: archivePath,
    snapshot_id: snapshotEvent.id,
    remaining: keep.length + 1,
  }, null, 2));
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function cmdPack(args: string[]) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const outDir = f.out ?? `./audit-pack-${(before ?? new Date().toISOString()).slice(0, 10)}`;
  const all = readAll(LEDGER);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  mkdirSync(outDir, { recursive: true });

  // --- general_ledger.csv ---
  const glHeader = "date,source,type,category,description,amount,currency,confidence,id";
  const glRows = events
    .filter((e) => !META_TYPES.has(e.type))
    .map((e) => [
      e.ts.slice(0, 10),
      csvEscape(e.source),
      e.type,
      csvEscape(String(e.data.category ?? "")),
      csvEscape(String(e.data.description ?? "")),
      String(e.data.amount ?? ""),
      String(e.data.currency ?? ""),
      String(e.data.confidence ?? ""),
      e.id,
    ].join(","));
  writeFileSync(`${outDir}/general_ledger.csv`, [glHeader, ...glRows].join("\n") + "\n", "utf-8");

  // --- reclassifications.csv ---
  const reclassEvents = all.filter((e) => e.type === "reclassify");
  if (reclassEvents.length > 0) {
    const rcHeader = "date,original_id,new_category,new_type,reason";
    const rcRows = reclassEvents.map((e) => [
      e.ts.slice(0, 10),
      String(e.data.original_id ?? ""),
      csvEscape(String(e.data.new_category ?? "")),
      csvEscape(String(e.data.new_type ?? "")),
      csvEscape(String(e.data.reason ?? "")),
    ].join(","));
    writeFileSync(`${outDir}/reclassifications.csv`, [rcHeader, ...rcRows].join("\n") + "\n", "utf-8");
  }

  // --- summary.json ---
  // Build reclassification map
  const reclassifyMap: Record<string, string> = {};
  for (const e of all) {
    if (e.type === "reclassify" && e.data.original_id && e.data.new_category) {
      reclassifyMap[String(e.data.original_id)] = String(e.data.new_category);
    }
  }

  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  let inflows = 0, outflows = 0;
  const reporting = buildReportingSections(events);

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;
    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;
    const type = e.type;
    const category = reclassifyMap[e.id] ?? String(e.data.category ?? e.type);
    const currency = String(e.data.currency ?? "UNKNOWN");
    if (!byType[type]) byType[type] = { count: 0, total: 0 };
    byType[type].count++; byType[type].total = round2(byType[type].total + amount);
    if (!byCategory[category]) byCategory[category] = { count: 0, total: 0 };
    byCategory[category].count++; byCategory[category].total = round2(byCategory[category].total + amount);
    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++; byCurrency[currency].total = round2(byCurrency[currency].total + amount);
    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  writeFileSync(`${outDir}/summary.json`, JSON.stringify({
    period: { after: after ?? "all", before: before ?? "now" },
    by_type: byType,
    by_category: byCategory,
    by_currency: byCurrency,
    cash_flow: { inflows, outflows, net: round2(inflows + outflows) },
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  }, null, 2) + "\n", "utf-8");

  // --- asset_register.csv ---
  const capitalizedEvents = events.filter((e) => e.data.capitalize === true);
  if (capitalizedEvents.length > 0) {
    const disposals: Record<string, LedgerEvent> = {};
    const writeOffsMap: Record<string, LedgerEvent> = {};
    const impairmentsMap: Record<string, LedgerEvent[]> = {};
    for (const e of all) {
      const aid = String(e.data.asset_id ?? "");
      if (!aid) continue;
      if (e.type === "disposal") disposals[aid] = e;
      else if (e.type === "write_off") writeOffsMap[aid] = e;
      else if (e.type === "impairment") {
        if (!impairmentsMap[aid]) impairmentsMap[aid] = [];
        impairmentsMap[aid].push(e);
      }
    }

    const asOf = before ?? new Date().toISOString();
    const defaultLife = 36;
    const arHeader = "date,description,category,cost,currency,useful_life,monthly_dep,months_elapsed,acc_dep,impairment,nbv,status,proceeds,gain_loss,id";
    const arRows = capitalizedEvents.map((e) => {
      const amount = Math.abs(Number(e.data.amount));
      const lifeMonths = Number(e.data.useful_life_months) || defaultLife;
      const purchaseDate = new Date(e.ts);
      const reportDate = new Date(asOf);
      const monthsElapsed = Math.max(0,
        (reportDate.getFullYear() - purchaseDate.getFullYear()) * 12 +
        (reportDate.getMonth() - purchaseDate.getMonth()));
      const monthlyDep = round2(amount / lifeMonths);
      const accDep = round2(Math.min(amount, monthlyDep * monthsElapsed));
      let impTotal = 0;
      if (impairmentsMap[e.id]) {
        for (const imp of impairmentsMap[e.id]) {
          impTotal = round2(impTotal + Math.abs(Number(imp.data.impairment_amount) || 0));
        }
      }
      const nbv = round2(Math.max(0, amount - accDep - impTotal));
      let status = "active";
      let proceeds = "";
      let gainLoss = "";
      if (disposals[e.id]) {
        status = "disposed";
        const p = Number(disposals[e.id].data.proceeds) || 0;
        proceeds = String(p);
        gainLoss = String(round2(p - nbv));
      } else if (writeOffsMap[e.id]) {
        status = "written_off";
        gainLoss = String(round2(-nbv));
      }
      return [
        e.ts.slice(0, 10),
        csvEscape(String(e.data.description ?? "")),
        csvEscape(String(e.data.category ?? "")),
        String(amount),
        String(e.data.currency ?? ""),
        String(lifeMonths),
        String(monthlyDep),
        String(Math.min(monthsElapsed, lifeMonths)),
        String(accDep),
        String(impTotal),
        status === "active" ? String(nbv) : "0",
        status,
        proceeds,
        gainLoss,
        e.id,
      ].join(",");
    });
    writeFileSync(`${outDir}/asset_register.csv`, [arHeader, ...arRows].join("\n") + "\n", "utf-8");
  }

  // --- verify.json ---
  const hash = createHash("sha256").update(events.map((e) => e.id).join(",")).digest("hex");
  let debits = 0, credits = 0;
  const issues: string[] = [];
  for (const e of events) {
    const amount = Number(e.data.amount);
    if (e.data.amount !== undefined && !isNaN(amount)) {
      if (amount < 0) debits = round2(debits + amount);
      else credits = round2(credits + amount);
      if (OUTFLOW_TYPES.has(e.type) && amount > 0) issues.push(`${e.id}: outflow "${e.type}" positive ${amount}`);
      if (INFLOW_TYPES.has(e.type) && amount < 0) issues.push(`${e.id}: inflow "${e.type}" negative ${amount}`);
    }
  }
  writeFileSync(`${outDir}/verify.json`, JSON.stringify({
    event_count: events.length, debits, credits, hash, issues,
    generated: new Date().toISOString(),
  }, null, 2) + "\n", "utf-8");

  // --- policy.md ---
  if (existsSync(POLICY)) {
    writeFileSync(`${outDir}/policy.md`, readFileSync(POLICY, "utf-8"), "utf-8");
  }

  // Summary output
  const files = ["general_ledger.csv", "summary.json", "verify.json"];
  if (reclassEvents.length > 0) files.push("reclassifications.csv");
  if (capitalizedEvents.length > 0) files.push("asset_register.csv");
  if (existsSync(POLICY)) files.push("policy.md");

  console.log(JSON.stringify({
    pack: outDir,
    period: { after: after ?? "all", before: before ?? "now" },
    events: events.length,
    files,
  }, null, 2));
}

// --- Help ---

const HELP = `clawbooks — accounting by inference, not by engine.

Data commands:
  record  <json>              Append one event to the ledger
  batch                       Append JSONL events from stdin
  log     [flags]             Print ledger events
  context [period] [flags]    Print compact policy + snapshot + events (use --verbose for full payloads)
  policy  [--path]            Print policy.md or just the path
  stats                       Ledger summary

Analysis commands:
  verify    [period] [--source S] [--balance N] [--currency C]
                                           Integrity + chain + balance check + duplicate detection
  reconcile [period] --source S [flags]    Compare expected vs actual totals
  review    [period] [--source S]          Show items needing classification review
  summary   [period] [--source S]          Pre-computed aggregates for reports
  snapshot  [period] [--save]              Compute period snapshot (balances, movement summary)
  assets    [--category C] [--life N] [--as-of DATE]
                                           Asset register (capitalize-flag based) with depreciation
  compact   <period> [--archive PATH]     Archive old events, save snapshot, shrink ledger
  pack      [period] [--source S] [--out DIR]
                                           Generate audit pack (CSVs + JSON + policy)

Common flags:
  --after  <ISO date>         Events after this date
  --before <ISO date>         Events before this date
  --source / -S <name>        Filter by source
  --type   / -T <name>        Filter by type
  --verbose                   Print full raw payloads where supported
  --include-policy            Inline the full policy in context output
  --last   <N>                Last N events (log only, default 20)

Reconcile flags:
  --count    <N>              Expected event count
  --debits   <N>              Expected debits total
  --credits  <N>              Expected credits total
  --currency <C>              Filter to a specific currency
  --gaps                      Detect date gaps >7 days

Verify flags:
  --balance  <N>              Cross-check net balance against expected value
  --opening-balance <N>       Treat expected balance as opening balance + period movement
  --currency <C>              Filter balance check to a specific currency

Period format:
  2026-03                     Single month
  2026-01/2026-06-30          Date range

Sign convention:
  Outflow types (expense, tax_payment, owner_draw, fee): amount stored as negative
  Inflow types: amount stored as positive
  Document types (invoice, bill): sign based on data.direction (issued=positive, received=negative)
  Meta types (snapshot, reclassify, opening_balance): sign not enforced
  Asset events (disposal, write_off, impairment): sign not enforced

Environment:
  CLAWBOOKS_LEDGER    default: ./ledger.jsonl
  CLAWBOOKS_POLICY    default: ./policy.md

Examples:
  clawbooks record '{"source":"bank","type":"expense","data":{"amount":100,"currency":"USD","description":"test"}}'
  cat events.jsonl | clawbooks batch
  clawbooks log --last 10 -S stripe
  clawbooks log -S bank -T expense
  clawbooks context 2026-03
  clawbooks context 2026-03 --include-policy
  clawbooks policy --path
  clawbooks verify 2026-03
  clawbooks reconcile 2026-03 --source bank --count 50 --debits -12000 --currency USD --gaps
  clawbooks review --source bank
  clawbooks verify 2026-03 --balance 153869.05 --currency USD
  clawbooks summary 2026-03
  clawbooks snapshot 2026-03 --save
  clawbooks assets --as-of 2026-03-31
  clawbooks compact 2025-12
  clawbooks pack 2026-03 --out ./march-pack

Agent workflow:
  1. Agent runs: clawbooks context 2026-03
  2. Agent reads the output and the policy
  3. Agent reasons over it and answers your question
  4. Agent runs: clawbooks record '...' to write new events
  5. Agent runs: clawbooks verify + reconcile to check integrity
  6. Agent runs: clawbooks summary to generate reports
  7. Agent runs: clawbooks snapshot --save to persist period summary
`;

// --- Dispatch ---

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "record":    cmdRecord(args); break;
  case "batch":     await cmdBatch(); break;
  case "log":       cmdLog(args); break;
  case "context":   cmdContext(args); break;
  case "policy":    cmdPolicy(args); break;
  case "stats":     cmdStats(); break;
  case "verify":    cmdVerify(args); break;
  case "reconcile": cmdReconcile(args); break;
  case "review":    cmdReview(args); break;
  case "summary":   cmdSummary(args); break;
  case "snapshot":  cmdSnapshot(args); break;
  case "assets":    cmdAssets(args); break;
  case "compact":   cmdCompact(args); break;
  case "pack":      cmdPack(args); break;
  default:          console.log(HELP);
}
