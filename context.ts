import type { LedgerEvent } from "./ledger.js";
import { META_TYPES } from "./event-types.js";
import { buildDocumentSettlementData } from "./documents.js";
import { buildCorrectionSummary, buildReviewMateriality, reviewCounts } from "./review.js";
import { buildBaseCurrencySummary, buildCategoryRollup, buildFxCoverage, buildReportingSections, round2, topCategoryEntries } from "./reporting.js";

export function buildContextSummary(params: {
  events: LedgerEvent[];
  reportingEvents: LedgerEvent[];
  all: LedgerEvent[];
  baseCurrency?: string;
  treatmentSummary: {
    active_count: number;
    by_kind: Record<string, number>;
  };
}) {
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
  const reporting = buildReportingSections(params.reportingEvents);
  const categoryRollup = buildCategoryRollup(params.reportingEvents);

  for (const e of params.events) {
    eventTypes.add(e.type);
    sources.add(e.source);
    if (e.type === "reclassify") rawReclassifications++;
    if (META_TYPES.has(e.type)) continue;

    nonMetaEvents++;
    const amount = Number(e.data.amount);
    const currency = String(e.data.currency ?? "UNKNOWN");
    const category = String(e.data.category ?? e.type);
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

  const confidence = reviewCounts(params.events, params.all);
  const needsReview = confidence.unclear + confidence.inferred + confidence.unset;
  const settlements = buildDocumentSettlementData(params.events);
  const reviewMateriality = buildReviewMateriality(params.events, params.all);
  const corrections = buildCorrectionSummary(params.events);
  const fxCoverage = params.baseCurrency ? buildFxCoverage(params.events, params.baseCurrency) : null;
  const baseCurrencyReporting = params.baseCurrency ? buildBaseCurrencySummary(params.events, params.baseCurrency) : null;

  return {
    event_count: params.events.length,
    non_meta_event_count: nonMetaEvents,
    event_types: [...eventTypes].sort(),
    sources: [...sources].sort(),
    currencies: [...currencies].sort(),
    by_type: byType,
    by_source: bySource,
    by_currency: byCurrency,
    by_category: byCategory,
    category_rollup: categoryRollup,
    cash_flow: {
      inflows: round2(inflows),
      outflows: round2(outflows),
      net: round2(inflows + outflows),
    },
    reclassifications: {
      raw_events_in_window: rawReclassifications,
      applied_to_events_in_window: 0,
    },
    treatments: {
      ...params.treatmentSummary,
      compiled_reporting_entries: Math.max(0, params.reportingEvents.length - params.events.length),
    },
    correction_summary: corrections,
    review: {
      needs_review: needsReview,
      by_confidence: confidence,
    },
    review_materiality: reviewMateriality,
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
    settlement_summary: settlements.settlement_summary,
    documents_by_direction: settlements.documents_by_direction,
    receivable_candidates: settlements.receivable_candidates,
    payable_candidates: settlements.payable_candidates,
    top_open_documents: settlements.items.slice(0, 5),
    ...(baseCurrencyReporting ? { base_currency_reporting: baseCurrencyReporting } : {}),
    ...(fxCoverage ? { fx_coverage: fxCoverage } : {}),
  };
}

export function buildCompactContextSummary(summary: ReturnType<typeof buildContextSummary>) {
  return {
    counts: {
      events: summary.event_count,
      non_meta_events: summary.non_meta_event_count,
      review_items: summary.review.needs_review,
    },
    movement_summary: summary.movement_summary,
    cash_flow: summary.cash_flow,
    report_totals: summary.report_totals,
    settlement_summary: summary.settlement_summary,
    receivable_candidates: summary.receivable_candidates,
    payable_candidates: summary.payable_candidates,
    correction_summary: summary.correction_summary,
    top_open_documents: summary.top_open_documents,
    top_operating_expenses: topCategoryEntries(summary.report_sections.operating_expenses),
    top_capex: topCategoryEntries(summary.report_sections.capex, 3),
    top_transfers: topCategoryEntries(summary.report_sections.internal_transfers, 3),
    review: summary.review,
    review_materiality: summary.review_materiality,
    ...(Object.prototype.hasOwnProperty.call(summary, "base_currency_reporting") ? { base_currency_reporting: summary.base_currency_reporting } : {}),
    ...(Object.prototype.hasOwnProperty.call(summary, "fx_coverage") ? { fx_coverage: summary.fx_coverage } : {}),
  };
}
