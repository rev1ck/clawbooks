import type { LedgerEvent } from "./ledger.js";
import { META_TYPES, classifyEventSection, signedAmount } from "./event-types.js";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sortByTimestamp(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) =>
    a.ts.localeCompare(b.ts)
    || String(a.id ?? "").localeCompare(String(b.id ?? ""))
    || JSON.stringify(a.data).localeCompare(JSON.stringify(b.data))
  );
}

function buildReportingSectionsWithAmount(events: LedgerEvent[], amountFor: (event: LedgerEvent) => number | undefined) {
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
    const amount = amountFor(e);
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

export function buildReportingSections(events: LedgerEvent[]) {
  return buildReportingSectionsWithAmount(events, signedAmount);
}

export function baseAmountForCurrency(event: LedgerEvent, baseCurrency: string): number | undefined {
  if (String(event.data.base_currency ?? "") !== baseCurrency) return undefined;
  const amount = Number(event.data.base_amount);
  return Number.isFinite(amount) ? amount : undefined;
}

export function buildReportingSectionsForBaseCurrency(events: LedgerEvent[], baseCurrency: string) {
  return buildReportingSectionsWithAmount(events, (event) => baseAmountForCurrency(event, baseCurrency));
}

type FxCoverageStatus = "complete" | "partial" | "none";

function buildCategoryRollupWithAmount(events: LedgerEvent[], amountFor: (event: LedgerEvent) => number | undefined) {
  const buckets: Record<string, {
    count: number;
    inflows: number;
    outflows: number;
    net: number;
    types: Set<string>;
    sections: Set<string>;
    currencies: Set<string>;
  }> = {};

  for (const event of events) {
    if (META_TYPES.has(event.type)) continue;
    const amount = amountFor(event);
    if (amount === undefined) continue;

    const category = String(event.data.category ?? event.type);
    const bucket = buckets[category] ?? {
      count: 0,
      inflows: 0,
      outflows: 0,
      net: 0,
      types: new Set<string>(),
      sections: new Set<string>(),
      currencies: new Set<string>(),
    };

    bucket.count++;
    if (amount >= 0) bucket.inflows = round2(bucket.inflows + amount);
    else bucket.outflows = round2(bucket.outflows + Math.abs(amount));
    bucket.net = round2(bucket.net + amount);
    bucket.types.add(event.type);
    bucket.sections.add(classifyEventSection(event));
    bucket.currencies.add(String(event.data.currency ?? "UNKNOWN"));
    buckets[category] = bucket;
  }

  return Object.fromEntries(
    Object.entries(buckets)
      .sort((left, right) => Math.abs(right[1].net) - Math.abs(left[1].net) || left[0].localeCompare(right[0]))
      .map(([category, bucket]) => [
        category,
        {
          count: bucket.count,
          inflows: bucket.inflows,
          outflows: bucket.outflows,
          net: bucket.net,
          types: [...bucket.types].sort(),
          sections: [...bucket.sections].sort(),
          currencies: [...bucket.currencies].sort(),
        },
      ]),
  );
}

export function buildCategoryRollup(events: LedgerEvent[]) {
  return buildCategoryRollupWithAmount(events, signedAmount);
}

export function buildCategoryRollupForBaseCurrency(events: LedgerEvent[], baseCurrency: string) {
  return buildCategoryRollupWithAmount(events, (event) => baseAmountForCurrency(event, baseCurrency));
}

export function buildFxCoverage(events: LedgerEvent[], baseCurrency: string) {
  const nativeCurrencyBreakdown: Record<string, number> = {};
  const missingExamples: Array<{
    id: string;
    ts: string;
    currency: string;
    amount: number;
    category: string;
    reason: "missing_base_amount" | "mismatched_base_currency";
    event_base_currency: string | null;
  }> = [];
  let eligibleEventCount = 0;
  let convertedEventCount = 0;
  let missingBaseAmountCount = 0;
  let mismatchedBaseCurrencyCount = 0;

  for (const event of events) {
    if (META_TYPES.has(event.type)) continue;
    const nativeAmount = Number(event.data.amount);
    if (!Number.isFinite(nativeAmount)) continue;

    eligibleEventCount++;
    const nativeCurrency = String(event.data.currency ?? "UNKNOWN");
    nativeCurrencyBreakdown[nativeCurrency] = (nativeCurrencyBreakdown[nativeCurrency] ?? 0) + 1;

    const convertedAmount = baseAmountForCurrency(event, baseCurrency);
    if (convertedAmount !== undefined) {
      convertedEventCount++;
      continue;
    }

    const eventBaseCurrency = typeof event.data.base_currency === "string" && event.data.base_currency.trim()
      ? String(event.data.base_currency)
      : null;
    const reason = eventBaseCurrency && eventBaseCurrency !== baseCurrency
      ? "mismatched_base_currency"
      : "missing_base_amount";

    if (reason === "mismatched_base_currency") mismatchedBaseCurrencyCount++;
    else missingBaseAmountCount++;

    if (missingExamples.length < 5) {
      missingExamples.push({
        id: event.id,
        ts: event.ts,
        currency: nativeCurrency,
        amount: nativeAmount,
        category: String(event.data.category ?? event.type),
        reason,
        event_base_currency: eventBaseCurrency,
      });
    }
  }

  const status: FxCoverageStatus = convertedEventCount === 0
    ? "none"
    : convertedEventCount === eligibleEventCount
      ? "complete"
      : "partial";

  return {
    requested_base_currency: baseCurrency,
    eligible_event_count: eligibleEventCount,
    converted_event_count: convertedEventCount,
    missing_base_amount_count: missingBaseAmountCount,
    mismatched_base_currency_count: mismatchedBaseCurrencyCount,
    native_currency_breakdown: nativeCurrencyBreakdown,
    missing_examples: missingExamples,
    status,
  };
}

export function convertedAmountWarnings(coverage: ReturnType<typeof buildFxCoverage>) {
  if (coverage.status === "complete") return [];
  if (coverage.status === "none") {
    return [
      `FX coverage is NONE for requested base currency ${coverage.requested_base_currency}; no events in scope have explicit converted facts.`,
    ];
  }
  return [
    `FX coverage is PARTIAL for requested base currency ${coverage.requested_base_currency}; converted facts exist for ${coverage.converted_event_count}/${coverage.eligible_event_count} eligible event(s).`,
    ...(coverage.missing_base_amount_count > 0
      ? [`${coverage.missing_base_amount_count} eligible event(s) are missing data.base_amount/data.base_currency for ${coverage.requested_base_currency}.`]
      : []),
    ...(coverage.mismatched_base_currency_count > 0
      ? [`${coverage.mismatched_base_currency_count} event(s) contain converted facts for a different base currency.`]
      : []),
  ];
}

export function buildBaseCurrencySummary(events: LedgerEvent[], baseCurrency: string) {
  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  let inflows = 0;
  let outflows = 0;

  for (const event of events) {
    if (META_TYPES.has(event.type)) continue;
    const amount = baseAmountForCurrency(event, baseCurrency);
    if (amount === undefined) continue;

    const category = String(event.data.category ?? event.type);
    if (!byType[event.type]) byType[event.type] = { count: 0, total: 0 };
    byType[event.type].count++;
    byType[event.type].total = round2(byType[event.type].total + amount);

    if (!byCategory[category]) byCategory[category] = { count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total = round2(byCategory[category].total + amount);

    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  const reporting = buildReportingSectionsForBaseCurrency(events, baseCurrency);
  const categoryRollup = buildCategoryRollupForBaseCurrency(events, baseCurrency);
  return {
    base_currency: baseCurrency,
    by_type: byType,
    by_category: byCategory,
    category_rollup: categoryRollup,
    cash_flow: {
      inflows,
      outflows,
      net: round2(inflows + outflows),
    },
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  };
}

export function topCategoryEntries(section: Record<string, number>, limit = 5): Array<{ category: string; total: number }> {
  return Object.entries(section)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, total]) => ({ category, total }));
}
