import type { LedgerEvent } from "./ledger.js";
import { DOCUMENT_TYPES, META_TYPES, signedAmount } from "./event-types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function inferDocumentDirection(event: LedgerEvent): "issued" | "received" | "unknown" {
  if (event.data.direction === "issued") return "issued";
  if (event.data.direction === "received") return "received";
  const amount = signedAmount(event);
  if (amount === undefined) return "unknown";
  if (amount > 0) return "issued";
  if (amount < 0) return "received";
  return "unknown";
}

export function agingBucket(days: number | null): string {
  if (days === null) return "no_due_date";
  if (days < 0) return "not_due";
  if (days <= 30) return "0_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}

export function isoDateDiffDays(a: string, b: string): number | null {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.floor((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
}

export function buildDocumentSettlementData(events: LedgerEvent[], asOf = new Date().toISOString()) {
  const documentGroups = new Map<string, {
    invoice_id: string;
    direction: "issued" | "received" | "unknown";
    document_count: number;
    document_total: number;
    document_magnitude: number;
    counterparty: string[];
    currencies: string[];
    due_dates: string[];
    first_document_ts: string;
    last_document_ts: string;
    matched_cash_total: number;
    matched_cash_magnitude: number;
    matched_cash_count: number;
    direction_mismatch_cash_total: number;
  }>();
  const unmatchedCash = new Map<string, {
    invoice_id: string;
    cash_event_count: number;
    cash_total: number;
    currencies: string[];
    sources: string[];
  }>();
  const documentsMissingInvoiceId: Array<{
    id: string;
    ts: string;
    type: string;
    direction: "issued" | "received" | "unknown";
    amount: number;
    due_date: string | null;
    counterparty: string;
  }> = [];

  for (const e of events) {
    if (META_TYPES.has(e.type) || !DOCUMENT_TYPES.has(e.type)) continue;
    const amount = signedAmount(e);
    if (amount === undefined) continue;
    const invoiceId = String(e.data.invoice_id ?? "").trim();
    const direction = inferDocumentDirection(e);
    if (!invoiceId) {
      documentsMissingInvoiceId.push({
        id: e.id,
        ts: e.ts,
        type: e.type,
        direction,
        amount,
        due_date: e.data.due_date ? String(e.data.due_date) : null,
        counterparty: String(e.data.counterparty ?? ""),
      });
      continue;
    }
    if (!documentGroups.has(invoiceId)) {
      documentGroups.set(invoiceId, {
        invoice_id: invoiceId,
        direction,
        document_count: 0,
        document_total: 0,
        document_magnitude: 0,
        counterparty: [],
        currencies: [],
        due_dates: [],
        first_document_ts: e.ts,
        last_document_ts: e.ts,
        matched_cash_total: 0,
        matched_cash_magnitude: 0,
        matched_cash_count: 0,
        direction_mismatch_cash_total: 0,
      });
    }
    const group = documentGroups.get(invoiceId)!;
    group.document_count++;
    group.document_total = round2(group.document_total + amount);
    group.document_magnitude = round2(group.document_magnitude + Math.abs(amount));
    group.first_document_ts = group.first_document_ts < e.ts ? group.first_document_ts : e.ts;
    group.last_document_ts = group.last_document_ts > e.ts ? group.last_document_ts : e.ts;
    const counterparty = String(e.data.counterparty ?? "");
    if (counterparty && !group.counterparty.includes(counterparty)) group.counterparty.push(counterparty);
    const currency = String(e.data.currency ?? "");
    if (currency && !group.currencies.includes(currency)) group.currencies.push(currency);
    const dueDate = String(e.data.due_date ?? "");
    if (dueDate && !group.due_dates.includes(dueDate)) group.due_dates.push(dueDate);
    if (group.direction === "unknown") group.direction = direction;
    else if (direction !== "unknown" && group.direction !== direction) group.direction = "unknown";
  }

  for (const e of events) {
    if (META_TYPES.has(e.type) || DOCUMENT_TYPES.has(e.type)) continue;
    const amount = signedAmount(e);
    if (amount === undefined) continue;
    const invoiceId = String(e.data.invoice_id ?? "").trim();
    if (!invoiceId) continue;
    if (documentGroups.has(invoiceId)) {
      const group = documentGroups.get(invoiceId)!;
      const directionMatches =
        (group.direction === "issued" && amount > 0)
        || (group.direction === "received" && amount < 0)
        || (group.direction === "unknown");
      if (directionMatches) {
        group.matched_cash_total = round2(group.matched_cash_total + amount);
        group.matched_cash_magnitude = round2(group.matched_cash_magnitude + Math.abs(amount));
        group.matched_cash_count++;
      } else {
        group.direction_mismatch_cash_total = round2(group.direction_mismatch_cash_total + amount);
      }
    } else {
      if (!unmatchedCash.has(invoiceId)) {
        unmatchedCash.set(invoiceId, {
          invoice_id: invoiceId,
          cash_event_count: 0,
          cash_total: 0,
          currencies: [],
          sources: [],
        });
      }
      const row = unmatchedCash.get(invoiceId)!;
      row.cash_event_count++;
      row.cash_total = round2(row.cash_total + amount);
      const currency = String(e.data.currency ?? "");
      if (currency && !row.currencies.includes(currency)) row.currencies.push(currency);
      if (!row.sources.includes(e.source)) row.sources.push(e.source);
    }
  }

  const documentsByDirection = {
    issued: { count: 0, total: 0 },
    received: { count: 0, total: 0 },
    unknown: { count: 0, total: 0 },
  };
  const settlementSummary = {
    tracked_documents: 0,
    missing_invoice_id_documents: documentsMissingInvoiceId.length,
    unmatched_cash_groups: unmatchedCash.size,
    open: 0,
    partial: 0,
    settled: 0,
    overpaid: 0,
  };
  const receivableCandidates = { count: 0, open_total: 0 };
  const payableCandidates = { count: 0, open_total: 0 };

  const items = [...documentGroups.values()]
    .map((group) => {
      settlementSummary.tracked_documents++;
      documentsByDirection[group.direction].count++;
      documentsByDirection[group.direction].total = round2(documentsByDirection[group.direction].total + group.document_magnitude);
      const dueDate = [...group.due_dates].sort()[0] ?? null;
      const ageDays = dueDate ? isoDateDiffDays(asOf, dueDate) : null;
      const openMagnitude = round2(group.document_magnitude - group.matched_cash_magnitude);
      let status: "open" | "partial" | "settled" | "overpaid";
      if (group.matched_cash_magnitude === 0) status = "open";
      else if (openMagnitude > 0) status = "partial";
      else if (openMagnitude === 0) status = "settled";
      else status = "overpaid";
      settlementSummary[status]++;
      if (group.direction === "issued" && openMagnitude > 0) {
        receivableCandidates.count++;
        receivableCandidates.open_total = round2(receivableCandidates.open_total + openMagnitude);
      }
      if (group.direction === "received" && openMagnitude > 0) {
        payableCandidates.count++;
        payableCandidates.open_total = round2(payableCandidates.open_total + openMagnitude);
      }
      return {
        invoice_id: group.invoice_id,
        direction: group.direction,
        document_count: group.document_count,
        document_total: round2(group.document_total),
        document_magnitude: round2(group.document_magnitude),
        matched_cash_total: round2(group.matched_cash_total),
        matched_cash_magnitude: round2(group.matched_cash_magnitude),
        open_balance: openMagnitude > 0 ? openMagnitude : 0,
        overpaid_balance: openMagnitude < 0 ? round2(Math.abs(openMagnitude)) : 0,
        matched_cash_count: group.matched_cash_count,
        due_date: dueDate,
        age_days: ageDays,
        aging_bucket: agingBucket(ageDays),
        status,
        counterparty: group.counterparty,
        currencies: group.currencies,
        first_document_ts: group.first_document_ts,
        last_document_ts: group.last_document_ts,
        direction_mismatch_cash_total: round2(group.direction_mismatch_cash_total),
      };
    })
    .sort((a, b) => b.open_balance - a.open_balance || a.invoice_id.localeCompare(b.invoice_id));

  return {
    settlement_summary: settlementSummary,
    documents_by_direction: documentsByDirection,
    receivable_candidates: receivableCandidates,
    payable_candidates: payableCandidates,
    items,
    documents_missing_invoice_id: documentsMissingInvoiceId.sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id)),
    unmatched_cash: [...unmatchedCash.values()].sort((a, b) => Math.abs(b.cash_total) - Math.abs(a.cash_total) || a.invoice_id.localeCompare(b.invoice_id)),
  };
}

type DocumentItem = ReturnType<typeof buildDocumentSettlementData>["items"][number];

function counterpartyGroupKey(item: DocumentItem): string {
  if (item.counterparty.length === 0) return "(missing)";
  if (item.counterparty.length > 1) return "(multiple)";
  return item.counterparty[0];
}

export function buildDocumentCounterpartySummary(items: DocumentItem[]) {
  const groups = new Map<string, {
    counterparty: string;
    document_count: number;
    invoice_count: number;
    open_balance: number;
    overpaid_balance: number;
    matched_cash_magnitude: number;
    document_magnitude: number;
    issued_count: number;
    received_count: number;
    statuses: Record<string, number>;
    currencies: Set<string>;
    first_document_ts: string | null;
    last_document_ts: string | null;
    invoice_ids: string[];
  }>();

  for (const item of items) {
    const key = counterpartyGroupKey(item);
    if (!groups.has(key)) {
      groups.set(key, {
        counterparty: key,
        document_count: 0,
        invoice_count: 0,
        open_balance: 0,
        overpaid_balance: 0,
        matched_cash_magnitude: 0,
        document_magnitude: 0,
        issued_count: 0,
        received_count: 0,
        statuses: {},
        currencies: new Set<string>(),
        first_document_ts: null,
        last_document_ts: null,
        invoice_ids: [],
      });
    }

    const row = groups.get(key)!;
    row.document_count += item.document_count;
    row.invoice_count += 1;
    row.open_balance = round2(row.open_balance + item.open_balance);
    row.overpaid_balance = round2(row.overpaid_balance + item.overpaid_balance);
    row.matched_cash_magnitude = round2(row.matched_cash_magnitude + item.matched_cash_magnitude);
    row.document_magnitude = round2(row.document_magnitude + item.document_magnitude);
    if (item.direction === "issued") row.issued_count += 1;
    if (item.direction === "received") row.received_count += 1;
    row.statuses[item.status] = (row.statuses[item.status] ?? 0) + 1;
    for (const currency of item.currencies) row.currencies.add(currency);
    row.first_document_ts = row.first_document_ts === null || item.first_document_ts < row.first_document_ts ? item.first_document_ts : row.first_document_ts;
    row.last_document_ts = row.last_document_ts === null || item.last_document_ts > row.last_document_ts ? item.last_document_ts : row.last_document_ts;
    row.invoice_ids.push(item.invoice_id);
  }

  return [...groups.values()]
    .map((row) => ({
      counterparty: row.counterparty,
      document_count: row.document_count,
      invoice_count: row.invoice_count,
      open_balance: row.open_balance,
      overpaid_balance: row.overpaid_balance,
      matched_cash_magnitude: row.matched_cash_magnitude,
      document_magnitude: row.document_magnitude,
      issued_count: row.issued_count,
      received_count: row.received_count,
      statuses: row.statuses,
      currencies: [...row.currencies].sort(),
      first_document_ts: row.first_document_ts,
      last_document_ts: row.last_document_ts,
      sample_invoice_ids: row.invoice_ids.sort().slice(0, 10),
    }))
    .sort((a, b) => b.open_balance - a.open_balance || a.counterparty.localeCompare(b.counterparty));
}
