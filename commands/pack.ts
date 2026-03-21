import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filter, readAll } from "../ledger.js";
import { buildAssetRegister } from "../assets.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { INFLOW_TYPES, META_TYPES, OUTFLOW_TYPES } from "../event-types.js";
import { buildCorrectionSummary, buildReclassifyMap, buildReviewMateriality } from "../review.js";
import { buildDocumentSettlementData } from "../documents.js";
import { buildReportingSections, round2, sortByTimestamp } from "../reporting.js";
import { buildWorkflowStatus } from "../workflow-state.js";

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

type PackParams = {
  booksDir?: string;
  ledgerPath: string;
  policyPath: string;
};

export function cmdPack(args: string[], params: PackParams) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const workflow = buildWorkflowStatus({ booksDir: params.booksDir ?? null, policyPath: params.policyPath });
  const packBase = params.booksDir ?? ".";
  const outDir = f.out ?? join(packBase, `audit-pack-${(before ?? new Date().toISOString()).slice(0, 10)}`);
  const all = readAll(params.ledgerPath);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  mkdirSync(outDir, { recursive: true });

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

  const reclassifyMap = buildReclassifyMap(all);
  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  let inflows = 0;
  let outflows = 0;
  const reporting = buildReportingSections(events);
  const settlements = buildDocumentSettlementData(events, before ?? new Date().toISOString());
  const reviewMateriality = buildReviewMateriality(events, all);
  const correctionSummaryPack = buildCorrectionSummary(events);

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;
    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;
    const type = e.type;
    const category = reclassifyMap[e.id] ?? String(e.data.category ?? e.type);
    const currency = String(e.data.currency ?? "UNKNOWN");
    if (!byType[type]) byType[type] = { count: 0, total: 0 };
    byType[type].count++;
    byType[type].total = round2(byType[type].total + amount);
    if (!byCategory[category]) byCategory[category] = { count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total = round2(byCategory[category].total + amount);
    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++;
    byCurrency[currency].total = round2(byCurrency[currency].total + amount);
    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  writeFileSync(`${outDir}/summary.json`, JSON.stringify({
    workflow,
    period: { after: after ?? "all", before: before ?? "now" },
    by_type: byType,
    by_category: byCategory,
    by_currency: byCurrency,
    cash_flow: { inflows, outflows, net: round2(inflows + outflows) },
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
    settlement_summary: settlements.settlement_summary,
    documents_by_direction: settlements.documents_by_direction,
    receivable_candidates: settlements.receivable_candidates,
    payable_candidates: settlements.payable_candidates,
    review_materiality: reviewMateriality,
    correction_summary: correctionSummaryPack,
  }, null, 2) + "\n", "utf-8");

  const assetRegister = buildAssetRegister(events, {
    asOf: before ?? new Date().toISOString(),
    defaultLife: 36,
  });
  const capitalizedEvents = [
    ...assetRegister.active,
    ...assetRegister.disposed,
    ...assetRegister.written_off,
  ];
  if (capitalizedEvents.length > 0) {
    const arHeader = "date,description,category,cost,currency,useful_life,monthly_dep,months_elapsed,acc_dep,impairment,nbv,status,proceeds,gain_loss,id";
    const arRows = [
      ...assetRegister.active.map((e) => [
        e.date,
        csvEscape(e.description),
        csvEscape(e.category),
        String(e.cost),
        e.currency,
        String(e.useful_life_months),
        String(e.monthly_depreciation),
        String(e.months_elapsed),
        String(e.accumulated_depreciation),
        String(e.impairment_total),
        String(e.net_book_value),
        "active",
        "",
        "",
        e.id,
      ].join(",")),
      ...assetRegister.disposed.map((e) => [
        e.date,
        csvEscape(e.description),
        csvEscape(e.category),
        String(e.cost),
        e.currency,
        String(e.useful_life_months),
        String(e.monthly_depreciation),
        String(e.months_elapsed),
        String(e.accumulated_depreciation),
        String(e.impairment_total),
        "0",
        "disposed",
        String(e.proceeds),
        String(e.gain_loss),
        e.id,
      ].join(",")),
      ...assetRegister.written_off.map((e) => [
        e.date,
        csvEscape(e.description),
        csvEscape(e.category),
        String(e.cost),
        e.currency,
        String(e.useful_life_months),
        String(e.monthly_depreciation),
        String(e.months_elapsed),
        String(e.accumulated_depreciation),
        String(e.impairment_total),
        "0",
        "written_off",
        "",
        String(e.loss),
        e.id,
      ].join(",")),
    ];
    writeFileSync(`${outDir}/asset_register.csv`, [arHeader, ...arRows].join("\n") + "\n", "utf-8");
  }

  const hash = createHash("sha256").update(events.map((e) => e.id).join(",")).digest("hex");
  let debits = 0;
  let credits = 0;
  const issues: string[] = [];
  const correctionSummaryVerify = buildCorrectionSummary(events);
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
    workflow,
    event_count: events.length,
    debits,
    credits,
    hash,
    issues,
    correction_summary: correctionSummaryVerify,
    generated: new Date().toISOString(),
  }, null, 2) + "\n", "utf-8");

  if (existsSync(params.policyPath)) {
    writeFileSync(`${outDir}/policy.md`, readFileSync(params.policyPath, "utf-8"), "utf-8");
  }

  const correctionEvents = all.filter((e) => e.type === "correction");
  if (correctionEvents.length > 0) {
    const header = "date,original_id,reason,corrected_fields,id";
    const rows = correctionEvents.map((e) => [
      e.ts.slice(0, 10),
      String(e.data.original_id ?? ""),
      csvEscape(String(e.data.reason ?? "")),
      csvEscape(JSON.stringify(e.data.corrected_fields ?? {})),
      e.id,
    ].join(","));
    writeFileSync(`${outDir}/corrections.csv`, [header, ...rows].join("\n") + "\n", "utf-8");
  }

  const confirmEvents = all.filter((e) => e.type === "confirm");
  if (confirmEvents.length > 0) {
    const header = "date,original_id,confidence,confirmed_by,notes,id";
    const rows = confirmEvents.map((e) => [
      e.ts.slice(0, 10),
      String(e.data.original_id ?? ""),
      csvEscape(String(e.data.confidence ?? "")),
      csvEscape(String(e.data.confirmed_by ?? e.data.recorded_by ?? "")),
      csvEscape(String(e.data.notes ?? "")),
      e.id,
    ].join(","));
    writeFileSync(`${outDir}/confirmations.csv`, [header, ...rows].join("\n") + "\n", "utf-8");
  }

  const files = ["general_ledger.csv", "summary.json", "verify.json"];
  if (reclassEvents.length > 0) files.push("reclassifications.csv");
  if (correctionEvents.length > 0) files.push("corrections.csv");
  if (confirmEvents.length > 0) files.push("confirmations.csv");
  if (capitalizedEvents.length > 0) files.push("asset_register.csv");
  if (existsSync(params.policyPath)) files.push("policy.md");
  writeFileSync(`${outDir}/workflow.json`, JSON.stringify(workflow, null, 2) + "\n", "utf-8");
  files.push("workflow.json");

  console.log(JSON.stringify({
    pack: outDir,
    workflow,
    period: { after: after ?? "all", before: before ?? "now" },
    events: events.length,
    files,
  }, null, 2));
}
