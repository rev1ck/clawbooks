import type { LedgerEvent } from "./ledger.js";
import { META_TYPES, classifyEventSection, signedAmount } from "./event-types.js";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sortByTimestamp(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
}

export function buildReportingSections(events: LedgerEvent[]) {
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

export function topCategoryEntries(section: Record<string, number>, limit = 5): Array<{ category: string; total: number }> {
  return Object.entries(section)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, total]) => ({ category, total }));
}
