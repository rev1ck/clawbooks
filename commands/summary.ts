import { readAll, filter } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { sortByTimestamp, buildReportingSections, round2 } from "../reporting.js";
import { buildReclassifyMap, buildReviewMateriality, buildCorrectionSummary } from "../review.js";
import { buildDocumentSettlementData } from "../documents.js";
import { META_TYPES } from "../event-types.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

export function cmdSummary(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const allowProvisional = f["allow-provisional"] === "true";
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  const all = readAll(ledgerPath);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));
  const nonMetaEvents = events.filter((e) => !META_TYPES.has(e.type));
  const firstEventTs = nonMetaEvents[0]?.ts ?? null;
  const lastEventTs = nonMetaEvents[nonMetaEvents.length - 1]?.ts ?? null;

  const reclassifyMap = buildReclassifyMap(all);
  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { type: string; count: number; total: number }> = {};
  const byMonth: Record<string, Record<string, number>> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  let inflows = 0;
  let outflows = 0;
  const reporting = buildReportingSections(events);
  const settlements = buildDocumentSettlementData(events);
  const reviewMateriality = buildReviewMateriality(events, all);
  const correctionSummary = buildCorrectionSummary(events);

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;

    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;

    const type = e.type;
    const category = reclassifyMap[e.id] ?? String(e.data.category ?? e.type);
    const month = e.ts.slice(0, 7);
    const currency = String(e.data.currency ?? "UNKNOWN");

    if (!byType[type]) byType[type] = { count: 0, total: 0 };
    byType[type].count++;
    byType[type].total = round2(byType[type].total + amount);

    if (!byCategory[category]) byCategory[category] = { type, count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total = round2(byCategory[category].total + amount);

    if (!byMonth[month]) byMonth[month] = {};
    byMonth[month][type] = round2((byMonth[month][type] ?? 0) + amount);

    if (!bySource[e.source]) bySource[e.source] = { count: 0, total: 0 };
    bySource[e.source].count++;
    bySource[e.source].total = round2(bySource[e.source].total + amount);

    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++;
    byCurrency[currency].total = round2(byCurrency[currency].total + amount);

    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  console.log(JSON.stringify({
    workflow,
    reporting_mode: workflow.reporting_mode,
    classification_basis: workflow.classification_basis,
    workflow_warning: workflow.warning,
    provisional_override: allowProvisional,
    requested_scope: {
      after: after ?? null,
      before: before ?? null,
      source: f.source ?? null,
    },
    resolved_scope: {
      after: after ?? null,
      before: before ?? null,
      source: f.source ?? null,
      event_count: events.length,
    },
    coverage: {
      first_event_ts: firstEventTs,
      last_event_ts: lastEventTs,
      source_count: Object.keys(bySource).length,
      source_completeness: "unknown",
      notes: [
        "Import full source coverage when practical, then cut report periods later.",
        "This summary reflects the resolved period/source filters above.",
      ],
    },
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
    settlement_summary: settlements.settlement_summary,
    documents_by_direction: settlements.documents_by_direction,
    receivable_candidates: settlements.receivable_candidates,
    payable_candidates: settlements.payable_candidates,
    top_open_documents: settlements.items.slice(0, 10),
    review_materiality: reviewMateriality,
    correction_summary: correctionSummary,
  }, null, 2));
}
