import { createHash } from "node:crypto";
import { buildAssetRegister, type AssetBaseRecord, type AssetRegister, type DisposedAssetRecord, type WrittenOffAssetRecord } from "./assets.js";
import { buildCompactContextSummary, buildContextSummary } from "./context.js";
import { buildDocumentSettlementData } from "./documents.js";
import { ASSET_EVENT_TYPES, DOCUMENT_TYPES, INFLOW_TYPES, META_TYPES, OUTFLOW_TYPES, enforceSign } from "./event-types.js";
import { filterByDateBasis, type DateBasis } from "./imports.js";
import { computeId, filter, hashLine, latestSnapshot, type LedgerEvent } from "./ledger.js";
import { classifyPolicyReadiness, lintPolicyText } from "./policy.js";
import { applyReclassifications, buildCorrectionSummary, buildConfirmedSet, buildReclassifyMap, buildReviewMateriality } from "./review.js";
import { buildCategoryRollup, buildReportingSections, round2, sortByTimestamp } from "./reporting.js";
import { VALID_CLASSIFICATION_BASES, deriveReportingMode } from "./workflow-state.js";
import type { ImportSessionSummary } from "./import-sessions.js";
import type { buildWorkflowStatus } from "./workflow-state.js";

export type WorkflowStatus = ReturnType<typeof buildWorkflowStatus>;

export function buildStats(all: LedgerEvent[]) {
  if (all.length === 0) return null;

  const sources = new Set(all.map((event) => event.source));
  const types = new Set(all.map((event) => event.type));
  const chronological = sortByTimestamp(all);

  return {
    events: all.length,
    snapshots: all.filter((event) => event.type === "snapshot").length,
    sources: [...sources],
    types: [...types],
    first: chronological[0].ts,
    last: chronological[chronological.length - 1].ts,
  };
}

export function buildAssetReport(opts: {
  all: LedgerEvent[];
  category?: string;
  defaultLife?: number;
  asOf?: string;
}) {
  const asOf = opts.asOf ?? new Date().toISOString();
  const defaultLife = opts.defaultLife ?? 36;
  const register = buildAssetRegister(opts.all, {
    category: opts.category,
    defaultLife,
    asOf,
  });

  return {
    as_of: asOf.slice(0, 10),
    category: opts.category ?? "all",
    useful_life_months_default: defaultLife,
    active: {
      count: register.active.length,
      total_cost: round2(register.active.reduce((sum, asset) => sum + asset.cost, 0)),
      accumulated_depreciation: round2(register.active.reduce((sum, asset) => sum + asset.accumulated_depreciation, 0)),
      net_book_value: round2(register.active.reduce((sum, asset) => sum + asset.net_book_value, 0)),
      assets: register.active,
    },
    disposed: {
      count: register.disposed.length,
      assets: register.disposed,
    },
    written_off: {
      count: register.written_off.length,
      assets: register.written_off,
    },
  };
}

export function buildDocumentReport(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
  asOf?: string;
  status?: string;
  direction?: string;
}) {
  const asOf = opts.asOf ?? new Date().toISOString();
  const events = sortByTimestamp(filter(opts.all, { after: opts.after, before: opts.before, source: opts.source }));
  const data = buildDocumentSettlementData(events, asOf);

  let items = data.items;
  if (opts.status) items = items.filter((item) => item.status === opts.status);
  if (opts.direction) items = items.filter((item) => item.direction === opts.direction);

  return {
    as_of: asOf,
    settlement_summary: data.settlement_summary,
    documents_by_direction: data.documents_by_direction,
    receivable_candidates: data.receivable_candidates,
    payable_candidates: data.payable_candidates,
    documents_missing_invoice_id: data.documents_missing_invoice_id,
    unmatched_cash: data.unmatched_cash,
    items,
  };
}

export function buildSnapshotData(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
}) {
  const events = sortByTimestamp(filter(opts.all, { after: opts.after, before: opts.before }));
  const effectiveEvents = applyReclassifications(events, opts.all);
  const balances: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let eventCount = 0;
  const reporting = buildReportingSections(effectiveEvents);
  const categoryRollup = buildCategoryRollup(effectiveEvents);

  for (const [index, event] of events.entries()) {
    const effectiveEvent = effectiveEvents[index];
    if (META_TYPES.has(event.type)) continue;

    const amount = Number(effectiveEvent.data.amount);
    if (Number.isNaN(amount)) continue;

    eventCount++;
    const currency = String(effectiveEvent.data.currency ?? "UNKNOWN");
    const category = String(effectiveEvent.data.category ?? effectiveEvent.type);

    balances[currency] = round2((balances[currency] ?? 0) + amount);
    byCategory[category] = round2((byCategory[category] ?? 0) + amount);
  }

  return {
    period: { after: opts.after ?? "all", before: opts.before ?? "now" },
    event_count: eventCount,
    balances,
    by_category: byCategory,
    category_rollup: categoryRollup,
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  };
}

export function analyzeVerification(all: LedgerEvent[], opts?: {
  source?: string;
  after?: string;
  before?: string;
  balance?: number;
  openingBalance?: number;
  currency?: string;
}) {
  const isFiltered = Boolean(opts?.source || opts?.after || opts?.before);
  const events = sortByTimestamp(filter(all, { after: opts?.after, before: opts?.before, source: opts?.source }));

  const byType: Record<string, { count: number; total: number }> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; debits: number; credits: number }> = {};
  const issues: string[] = [];
  let debits = 0;
  let credits = 0;

  for (const event of events) {
    if (!byType[event.type]) byType[event.type] = { count: 0, total: 0 };
    byType[event.type].count++;

    if (!bySource[event.source]) bySource[event.source] = { count: 0, total: 0 };
    bySource[event.source].count++;

    const amount = Number(event.data.amount);
    if (event.data.amount !== undefined && Number.isNaN(amount)) {
      issues.push(`Event ${event.id}: non-numeric amount "${event.data.amount}"`);
    } else if (event.data.amount !== undefined) {
      byType[event.type].total = round2(byType[event.type].total + amount);
      bySource[event.source].total = round2(bySource[event.source].total + amount);

      if (amount < 0) debits = round2(debits + amount);
      else credits = round2(credits + amount);

      const currency = String(event.data.currency ?? "UNKNOWN");
      if (!byCurrency[currency]) byCurrency[currency] = { count: 0, debits: 0, credits: 0 };
      byCurrency[currency].count++;
      if (amount < 0) byCurrency[currency].debits = round2(byCurrency[currency].debits + amount);
      else byCurrency[currency].credits = round2(byCurrency[currency].credits + amount);
    }

    if (event.data.amount !== undefined && !Number.isNaN(amount)) {
      if (OUTFLOW_TYPES.has(event.type) && amount > 0) {
        issues.push(`Event ${event.id}: outflow type "${event.type}" has positive amount ${amount}`);
      } else if (INFLOW_TYPES.has(event.type) && amount < 0) {
        issues.push(`Event ${event.id}: inflow type "${event.type}" has negative amount ${amount}`);
      } else if (DOCUMENT_TYPES.has(event.type)) {
        if (event.data.direction === "issued" && amount < 0) {
          issues.push(`Event ${event.id}: document type "${event.type}" with direction "issued" has negative amount ${amount}`);
        } else if (event.data.direction === "received" && amount > 0) {
          issues.push(`Event ${event.id}: document type "${event.type}" with direction "received" has positive amount ${amount}`);
        }
      }
    }

    if (!event.source) issues.push(`Event ${event.id}: missing source`);
    if (!event.type) issues.push(`Event ${event.id}: missing type`);
    if (!event.data || typeof event.data !== "object") issues.push(`Event ${event.id}: missing or invalid data`);
  }

  let chainValid = true;
  if (!isFiltered) {
    for (let index = 0; index < all.length; index++) {
      if (index === 0) {
        if (all[index].prev !== "genesis") {
          issues.push(`Event ${all[index].id}: first event prev should be "genesis", got "${all[index].prev}"`);
          chainValid = false;
        }
        continue;
      }

      const expectedPrev = hashLine(JSON.stringify({ ...all[index - 1] }));
      if (all[index].prev !== expectedPrev) {
        issues.push(`Event ${all[index].id}: chain break at index ${index} (expected prev ${expectedPrev}, got ${all[index].prev})`);
        chainValid = false;
      }
    }
  }

  let balanceCheck: {
    expected: number;
    actual: number;
    difference: number;
    matches: boolean;
    opening_balance?: number;
    net_movement?: number;
    closing_balance?: number;
  } | undefined;

  if (opts?.balance !== undefined) {
    const openingBalance = opts.openingBalance ?? 0;
    let movement = 0;

    for (const event of events) {
      if (META_TYPES.has(event.type)) continue;
      const amount = Number(event.data.amount);
      if (Number.isNaN(amount)) continue;
      if (opts.currency && String(event.data.currency) !== opts.currency) continue;
      movement = round2(movement + amount);
    }

    const actual = round2(openingBalance + movement);
    const difference = round2(actual - opts.balance);
    const matches = Math.abs(difference) < 0.01;
    balanceCheck = {
      expected: opts.balance,
      actual,
      difference,
      matches,
    };
    if (!matches) {
      issues.push(`Balance mismatch: expected ${opts.balance}, got ${actual} (difference: ${difference})`);
    }
    if (opts.openingBalance !== undefined) {
      Object.assign(balanceCheck, {
        opening_balance: openingBalance,
        net_movement: movement,
        closing_balance: actual,
      });
    }
  }

  const duplicateGroups: Record<string, string[]> = {};
  for (const event of events) {
    if (META_TYPES.has(event.type) || ASSET_EVENT_TYPES.has(event.type)) continue;
    const key = `${event.source}|${event.ts.slice(0, 10)}|${event.data.amount}|${event.data.description ?? ""}`;
    if (!duplicateGroups[key]) duplicateGroups[key] = [];
    duplicateGroups[key].push(event.id);
  }
  const potentialDuplicates = Object.values(duplicateGroups).filter((ids) => ids.length > 1);

  const hash = createHash("sha256")
    .update(events.map((event) => event.id).join(","))
    .digest("hex");

  return {
    event_count: events.length,
    by_type: byType,
    by_source: bySource,
    by_currency: byCurrency,
    debits: round2(debits),
    credits: round2(credits),
    ...(isFiltered ? {} : { chain_valid: chainValid }),
    ...(balanceCheck ? { balance_check: balanceCheck } : {}),
    ...(potentialDuplicates.length > 0 ? { potential_duplicates: potentialDuplicates } : {}),
    hash,
    issues,
  };
}

export function buildSummary(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
}) {
  const events = sortByTimestamp(filter(opts.all, { after: opts.after, before: opts.before, source: opts.source }));
  const effectiveEvents = applyReclassifications(events, opts.all);
  const nonMetaEvents = events.filter((event) => !META_TYPES.has(event.type));
  const firstEventTs = nonMetaEvents[0]?.ts ?? null;
  const lastEventTs = nonMetaEvents[nonMetaEvents.length - 1]?.ts ?? null;
  const reclassifyMap = buildReclassifyMap(opts.all);
  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { type: string; count: number; total: number }> = {};
  const byMonth: Record<string, Record<string, number>> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  let inflows = 0;
  let outflows = 0;
  const reporting = buildReportingSections(effectiveEvents);
  const categoryRollup = buildCategoryRollup(effectiveEvents);
  const settlements = buildDocumentSettlementData(events);
  const reviewMateriality = buildReviewMateriality(events, opts.all);
  const correctionSummary = buildCorrectionSummary(events);

  for (const [index, event] of events.entries()) {
    const effectiveEvent = effectiveEvents[index];
    if (META_TYPES.has(event.type)) continue;

    const amount = Number(effectiveEvent.data.amount);
    if (Number.isNaN(amount)) continue;

    const category = reclassifyMap[event.id] ?? String(effectiveEvent.data.category ?? effectiveEvent.type);
    const month = event.ts.slice(0, 7);
    const currency = String(effectiveEvent.data.currency ?? "UNKNOWN");

    if (!byType[effectiveEvent.type]) byType[effectiveEvent.type] = { count: 0, total: 0 };
    byType[effectiveEvent.type].count++;
    byType[effectiveEvent.type].total = round2(byType[effectiveEvent.type].total + amount);

    if (!byCategory[category]) byCategory[category] = { type: effectiveEvent.type, count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total = round2(byCategory[category].total + amount);

    if (!byMonth[month]) byMonth[month] = {};
    byMonth[month][effectiveEvent.type] = round2((byMonth[month][effectiveEvent.type] ?? 0) + amount);

    if (!bySource[event.source]) bySource[event.source] = { count: 0, total: 0 };
    bySource[event.source].count++;
    bySource[event.source].total = round2(bySource[event.source].total + amount);

    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++;
    byCurrency[currency].total = round2(byCurrency[currency].total + amount);

    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  return {
    requested_scope: {
      after: opts.after ?? null,
      before: opts.before ?? null,
      source: opts.source ?? null,
    },
    resolved_scope: {
      after: opts.after ?? null,
      before: opts.before ?? null,
      source: opts.source ?? null,
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
    category_rollup: categoryRollup,
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
  };
}

export function buildReconciliation(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
  dateBasis?: DateBasis;
  currency?: string;
  count?: number;
  debits?: number;
  credits?: number;
  openingBalance?: number;
  closingBalance?: number;
  gaps?: boolean;
}) {
  if (!opts.source) {
    throw new Error("Usage: clawbooks reconcile [period] --source S [--count N] [--debits N] [--credits N] [--currency C]");
  }

  const dateBasis = opts.dateBasis ?? "ledger";
  if (!["ledger", "transaction", "posting"].includes(dateBasis)) {
    throw new Error("Invalid --date-basis. Use ledger, transaction, or posting.");
  }

  const sourceEvents = filter(opts.all, { source: opts.source });
  const dated = filterByDateBasis(sourceEvents, { after: opts.after, before: opts.before, basis: dateBasis });
  let events = sortByTimestamp(dated.events);

  if (opts.currency) {
    events = events.filter((event) => String(event.data.currency) === opts.currency);
  }

  let actualDebits = 0;
  let actualCredits = 0;
  let netMovement = 0;
  for (const event of events) {
    const amount = Number(event.data.amount);
    if (!Number.isNaN(amount)) {
      netMovement = round2(netMovement + amount);
      if (amount < 0) actualDebits = round2(actualDebits + amount);
      else actualCredits = round2(actualCredits + amount);
    }
  }

  const expected: Record<string, number> = {};
  const actual: Record<string, number> = {};
  const differences: Record<string, number> = {};
  const issues: string[] = [];
  let status = "NO_EXPECTATIONS";

  if (opts.count !== undefined) {
    expected.count = opts.count;
    actual.count = events.length;
    differences.count = actual.count - expected.count;
    if (differences.count !== 0) issues.push(`Count mismatch: expected ${expected.count}, got ${actual.count}`);
    status = "RECONCILED";
  }

  if (opts.debits !== undefined) {
    expected.debits = opts.debits;
    actual.debits = actualDebits;
    differences.debits = round2(actual.debits - expected.debits);
    if (Math.abs(differences.debits) > 0.01) issues.push(`Debits mismatch: expected ${expected.debits}, got ${actual.debits}`);
    status = "RECONCILED";
  }

  if (opts.credits !== undefined) {
    expected.credits = opts.credits;
    actual.credits = actualCredits;
    differences.credits = round2(actual.credits - expected.credits);
    if (Math.abs(differences.credits) > 0.01) issues.push(`Credits mismatch: expected ${expected.credits}, got ${actual.credits}`);
    status = "RECONCILED";
  }

  if (opts.openingBalance !== undefined) {
    expected.opening_balance = opts.openingBalance;
    actual.opening_balance = opts.openingBalance;
    differences.opening_balance = 0;
    status = "RECONCILED";
  }

  if (opts.closingBalance !== undefined) {
    expected.closing_balance = opts.closingBalance;
    actual.closing_balance = opts.openingBalance !== undefined
      ? round2(opts.openingBalance + netMovement)
      : round2(netMovement);
    differences.closing_balance = round2(actual.closing_balance - expected.closing_balance);
    if (Math.abs(differences.closing_balance) > 0.01) {
      issues.push(`Closing balance mismatch: expected ${expected.closing_balance}, got ${actual.closing_balance}`);
    }
    status = "RECONCILED";
  }

  if (issues.length > 0) status = "MISMATCH";

  let gaps: string[] | undefined;
  if (opts.gaps) {
    gaps = [];
    const dates = events
      .filter((event) => !META_TYPES.has(event.type))
      .map((event) => event.ts.slice(0, 10))
      .filter((date, index, allDates) => allDates.indexOf(date) === index)
      .sort();
    for (let index = 1; index < dates.length; index++) {
      const previous = new Date(dates[index - 1]);
      const current = new Date(dates[index]);
      const diffDays = Math.round((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) gaps.push(`${dates[index - 1]} → ${dates[index]} (${diffDays} days)`);
    }
  }

  return {
    requested_scope: {
      after: opts.after ?? null,
      before: opts.before ?? null,
      source: opts.source,
      currency: opts.currency ?? null,
    },
    date_basis: dateBasis,
    period: { after: opts.after ?? null, before: opts.before ?? null },
    resolved_scope: {
      after: opts.after ?? null,
      before: opts.before ?? null,
      source: opts.source,
      currency: opts.currency ?? null,
      event_count: events.length,
    },
    expected,
    actual,
    differences,
    status,
    issues,
    what_matters: status === "RECONCILED"
      ? "Imported totals matched the active reconciliation checks."
      : status === "MISMATCH"
        ? "One or more reconciliation checks failed."
        : "No explicit expectations were supplied, so reconcile reported actuals only.",
    next_best_command: status === "RECONCILED" ? "clawbooks review" : "clawbooks import check",
    net_movement: netMovement,
    missing_date_basis_events: dated.missingBasisIds.length,
    ...(gaps ? { gaps } : {}),
  };
}

export function buildCompactPlan(opts: {
  all: LedgerEvent[];
  before?: string;
}) {
  if (!opts.before) {
    throw new Error("Usage: clawbooks compact <period> or --before <date>");
  }

  const keep = sortByTimestamp(opts.all.filter((event) => event.ts > opts.before!));
  const archive = sortByTimestamp(opts.all.filter((event) => event.ts <= opts.before!));

  if (archive.length === 0) {
    return {
      compacted: false as const,
      reason: "no events before cutoff",
      archive,
      keep,
    };
  }

  const snapshotData = {
    ...buildSnapshotData({ all: archive, before: opts.before }),
    compacted_from: archive.length,
  };
  const snapshotEvent: LedgerEvent = {
    ts: opts.before,
    source: "clawbooks:compact",
    type: "snapshot",
    data: snapshotData,
    id: computeId(snapshotData as Record<string, unknown>, {
      source: "clawbooks:compact",
      type: "snapshot",
      ts: opts.before,
    }),
    prev: "",
  };

  return {
    compacted: true as const,
    archive,
    keep,
    snapshot_data: snapshotData,
    snapshot_event: snapshotEvent,
  };
}

function buildReviewSelection(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
  confidence?: string[] | null;
  minMagnitude?: number | null;
  limit?: number | null;
  groupBy?: string | null;
}) {
  const events = sortByTimestamp(filter(opts.all, { after: opts.after, before: opts.before, source: opts.source }));
  const reclassified = new Set(
    opts.all.filter((event) => event.type === "reclassify").map((event) => String(event.data.original_id)),
  );
  const confirmed = buildConfirmedSet(opts.all);
  const reviewable = events
    .filter((event) => !META_TYPES.has(event.type))
    .filter((event) => !reclassified.has(event.id))
    .filter((event) => !confirmed.has(event.id));

  const requestedConfidence = opts.confidence ? new Set(opts.confidence) : null;
  const candidates: LedgerEvent[] = [];
  for (const event of reviewable) {
    const confidence = String(event.data.confidence ?? "unset");
    if (confidence === "clear") continue;

    const amount = Number(event.data.amount);
    if (opts.minMagnitude !== null && opts.minMagnitude !== undefined && Number.isFinite(amount) && Math.abs(amount) < opts.minMagnitude) {
      continue;
    }
    if (requestedConfidence && !requestedConfidence.has(confidence)) continue;
    candidates.push(event);
  }

  const confidenceRank: Record<string, number> = { unclear: 0, inferred: 1, unset: 2 };
  let items = [...candidates].sort((left, right) => {
    const leftAmount = Math.abs(Number(left.data.amount) || 0);
    const rightAmount = Math.abs(Number(right.data.amount) || 0);
    return rightAmount - leftAmount
      || (confidenceRank[String(left.data.confidence ?? "unset")] ?? 9) - (confidenceRank[String(right.data.confidence ?? "unset")] ?? 9)
      || left.ts.localeCompare(right.ts)
      || left.id.localeCompare(right.id);
  });
  if (opts.limit !== null && opts.limit !== undefined) items = items.slice(0, opts.limit);

  const tiers: Record<string, LedgerEvent[]> = { unclear: [], inferred: [], unset: [] };
  for (const event of candidates) {
    const confidence = String(event.data.confidence ?? "unset");
    if (confidence === "unclear") tiers.unclear.push(event);
    else if (confidence === "inferred") tiers.inferred.push(event);
    else tiers.unset.push(event);
  }

  const visibleIds = new Set(items.map((event) => event.id));
  const visibleTiers = {
    unclear: tiers.unclear.filter((event) => visibleIds.has(event.id)),
    inferred: tiers.inferred.filter((event) => visibleIds.has(event.id)),
    unset: tiers.unset.filter((event) => visibleIds.has(event.id)),
  };

  return {
    items,
    visibleTiers,
    fullTiers: tiers,
    events,
    filters: {
      confidence: requestedConfidence ? [...requestedConfidence] : null,
      min_magnitude: opts.minMagnitude ?? null,
      limit: opts.limit ?? null,
      group_by: opts.groupBy ?? null,
      source: opts.source ?? null,
      after: opts.after ?? null,
      before: opts.before ?? null,
    },
  };
}

export function buildReviewQueue(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
  confidence?: string[] | null;
  minMagnitude?: number | null;
  limit?: number | null;
  groupBy?: string | null;
}) {
  const { items, visibleTiers, fullTiers, events, filters } = buildReviewSelection(opts);
  const reviewMateriality = buildReviewMateriality(events, opts.all);
  const filteredMateriality = items.reduce((acc, event) => {
    const confidence = String(event.data.confidence ?? "unset");
    if (!(confidence in acc.by_confidence)) return acc;
    const bucket = acc.by_confidence[confidence as keyof typeof acc.by_confidence];
    const amount = Number(event.data.amount);
    bucket.count++;
    bucket.magnitude += Number.isFinite(amount) ? Math.abs(amount) : 0;
    return acc;
  }, {
    by_confidence: {
      unclear: { count: 0, magnitude: 0 },
      inferred: { count: 0, magnitude: 0 },
      unset: { count: 0, magnitude: 0 },
    },
  });

  const validGroupBy = new Set(["category", "source", "type"]);
  const groups = filters.group_by && validGroupBy.has(filters.group_by)
    ? items.reduce((acc, event) => {
      const key = String(
        filters.group_by === "source"
          ? event.source
          : filters.group_by === "type"
            ? event.type
            : event.data.category ?? "uncategorized",
      );
      const amount = Number(event.data.amount);
      const bucket = acc[key] ?? { count: 0, magnitude: 0, ids: [] as string[] };
      bucket.count++;
      bucket.magnitude += Number.isFinite(amount) ? Math.abs(amount) : 0;
      bucket.ids.push(event.id);
      acc[key] = bucket;
      return acc;
    }, {} as Record<string, { count: number; magnitude: number; ids: string[] }>)
    : null;

  const nextActions = items.slice(0, 10).map((event) => {
    const category = String(event.data.category ?? event.type);
    const confidence = String(event.data.confidence ?? "unset");
    return {
      id: event.id,
      confidence,
      amount: Number(event.data.amount),
      category,
      reason_in_queue: confidence === "unclear"
        ? "confidence is unclear"
        : confidence === "inferred"
          ? "confidence is inferred"
          : "confidence is missing or unset",
      source_description: String(event.data.description ?? ""),
      confirm_command: `clawbooks record '${JSON.stringify({ source: "manual", type: "confirm", data: { original_id: event.id, confidence: "clear", confirmed_by: "reviewer", notes: "replace with review note" } })}'`,
      reclassify_command: `clawbooks record '${JSON.stringify({ source: "manual", type: "reclassify", data: { original_id: event.id, new_category: category } })}'`,
    };
  });

  return {
    needs_review: items.length,
    filters,
    resolved_scope: {
      after: filters.after,
      before: filters.before,
      source: filters.source,
    },
    by_confidence: {
      unclear: visibleTiers.unclear.length,
      inferred: visibleTiers.inferred.length,
      unset: visibleTiers.unset.length,
    },
    total_by_confidence: {
      unclear: fullTiers.unclear.length,
      inferred: fullTiers.inferred.length,
      unset: fullTiers.unset.length,
    },
    materiality: {
      full_queue: reviewMateriality,
      filtered_queue: filteredMateriality,
    },
    queue: {
      highest_confidence_risk: items[0]?.id ?? null,
      suggested_order: items.map((event) => event.id),
      total_visible_items: items.length,
    },
    workflow_state: items.length === 0 ? "queue_empty" : "queue_ready",
    what_matters: items.length === 0
      ? "No review items matched the current filters."
      : `${items.length} item(s) are ready for review, ordered by materiality.`,
    next_best_command: items.length === 0
      ? "clawbooks summary"
      : "clawbooks review batch --out review-actions.jsonl --action confirm --confidence inferred",
    groups,
    next_actions: nextActions,
    items: items.map((event) => {
      const confidence = String(event.data.confidence ?? "unset");
      const amount = Number(event.data.amount);
      return {
        id: event.id,
        ts: event.ts,
        source: event.source,
        type: event.type,
        category: String(event.data.category ?? event.type),
        amount,
        magnitude: Math.abs(Number.isFinite(amount) ? amount : 0),
        confidence,
        source_description: String(event.data.description ?? ""),
        reason_in_queue: confidence === "unclear"
          ? "confidence is unclear"
          : confidence === "inferred"
            ? "confidence is inferred"
            : "confidence is missing or unset",
      };
    }),
    message: items.length === 0
      ? "No review items matched the current filters. Review includes inferred, unclear, and unset confidence by default."
      : null,
  };
}

export function buildReviewBatch(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
  confidence?: string[] | null;
  minMagnitude?: number | null;
  limit?: number | null;
  action: string;
  outPath: string;
  confirmedBy?: string;
  notes?: string;
  newCategory?: string;
}) {
  if (!["confirm", "reclassify"].includes(opts.action)) {
    throw new Error("Invalid --action. Use confirm or reclassify.");
  }

  const { items, filters } = buildReviewSelection({
    all: opts.all,
    after: opts.after,
    before: opts.before,
    source: opts.source,
    confidence: opts.confidence,
    minMagnitude: opts.minMagnitude,
    limit: opts.limit,
    groupBy: null,
  });

  if (items.length === 0) {
    return {
      lines: [] as string[],
      report: {
        command: "review batch",
        status: "empty",
        action: opts.action,
        out_path: opts.outPath,
        item_count: 0,
        filters,
        next_steps: [
          "No matching review items were found for the requested filters.",
          "Relax the filters or run `clawbooks review` first to inspect the queue.",
        ],
      },
    };
  }

  if (opts.action === "reclassify" && !opts.newCategory) {
    throw new Error("Bulk reclassify requires --new-category CAT.");
  }

  const lines = items.map((event) => {
    if (opts.action === "confirm") {
      return JSON.stringify({
        source: "manual",
        type: "confirm",
        data: {
          original_id: event.id,
          confidence: "clear",
          confirmed_by: opts.confirmedBy ?? "review-batch",
          notes: opts.notes ?? "bulk review confirmation",
        },
      });
    }
    return JSON.stringify({
      source: "manual",
      type: "reclassify",
      data: {
        original_id: event.id,
        new_category: opts.newCategory,
      },
    });
  });

  return {
    lines,
    report: {
      command: "review batch",
      status: "ok",
      action: opts.action,
      out_path: opts.outPath,
      item_count: items.length,
      filters,
      next_steps: [
        "Inspect the generated JSONL before appending it.",
        `Append it with \`clawbooks batch < ${opts.outPath}\` once you are satisfied.`,
      ],
    },
  };
}

export function prepareRecord(opts: {
  parsed: {
    source?: string;
    type?: string;
    data?: Record<string, unknown>;
    ts?: string;
  };
  defaultTs?: string;
}) {
  if (!opts.parsed.source || !opts.parsed.type || !opts.parsed.data || typeof opts.parsed.data !== "object" || Array.isArray(opts.parsed.data)) {
    throw new Error("Required fields: source, type, data");
  }

  const data = { ...opts.parsed.data };
  const warning = enforceSign(opts.parsed.type, data);
  const ts = opts.parsed.ts ?? opts.defaultTs ?? new Date().toISOString();
  const event: LedgerEvent = {
    ts,
    source: opts.parsed.source,
    type: opts.parsed.type,
    data,
    id: computeId(data, { source: opts.parsed.source, type: opts.parsed.type, ts }),
    prev: "",
  };

  return { event, warning };
}

export function prepareBatch(opts: {
  input: string;
  existingLines: string[];
  now?: () => string;
}) {
  const existingIds = new Set(
    opts.existingLines.map((line) => (JSON.parse(line) as LedgerEvent).id),
  );
  let prevHash = opts.existingLines.length > 0 ? hashLine(opts.existingLines[opts.existingLines.length - 1]) : "genesis";
  let recorded = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  const warnings: string[] = [];
  const newLines: string[] = [];
  const now = opts.now ?? (() => new Date().toISOString());

  for (const line of opts.input.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as {
        source?: string;
        type?: string;
        data?: Record<string, unknown>;
        ts?: string;
      } & Record<string, unknown>;
      const source = parsed.source ?? "import";
      const type = parsed.type ?? "unknown";
      const dataCandidate = parsed.data ?? parsed;
      if (!dataCandidate || typeof dataCandidate !== "object" || Array.isArray(dataCandidate)) {
        throw new Error(`Invalid event payload for type "${type}"`);
      }
      const data = { ...dataCandidate };
      const warning = enforceSign(type, data);
      if (warning) warnings.push(warning);

      const ts = parsed.ts ?? now();
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
    } catch (error) {
      errors++;
      errorMessages.push(String((error as Error).message));
    }
  }

  return { recorded, skipped, errors, errorMessages, warnings, newLines };
}

export function buildContext(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  verbose?: boolean;
  includePolicy?: boolean;
  allowProvisional?: boolean;
  ledgerPath: string;
  policyPath: string;
  policyText: string;
  workflow: WorkflowStatus;
  generatedAt?: string;
}) {
  const snapshot = latestSnapshot(opts.all, opts.after);
  const effectiveAfter = snapshot?.ts ?? opts.after;
  const events = sortByTimestamp(filter(opts.all, { after: effectiveAfter, before: opts.before }).filter((event) => event.type !== "snapshot"));
  const summary = buildContextSummary(events, opts.all);
  const summaryOut = opts.verbose ? summary : buildCompactContextSummary(summary);
  const metadata = {
    schema_version: "clawbooks.context.v2",
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    ledger_path: opts.ledgerPath,
    policy_path: opts.policyPath,
    requested_window: {
      after: opts.after ?? "all",
      before: opts.before ?? "now",
    },
    effective_window: {
      after: effectiveAfter ?? "all",
      before: opts.before ?? "now",
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
    workflow: opts.workflow,
    provisional_override: opts.allowProvisional === true,
  };

  const instructions = [
    opts.workflow.reporting_mode === "policy_grounded" ? "Status: POLICY_GROUNDED" : "Status: PROVISIONAL",
    "Read the policy first.",
    ...(opts.workflow.reporting_readiness !== "ready" && opts.workflow.warning
      ? [
        `Workflow warning: ${opts.workflow.warning}`,
        ...(opts.allowProvisional
          ? []
          : ["Use --allow-provisional to explicitly acknowledge exploratory output in automation or scripted runs."]),
      ]
      : []),
    "Use the policy path in metadata or run `clawbooks policy` to inspect the full policy text.",
    ...(snapshot
      ? [
        "Treat the snapshot as the starting state up to its as_of timestamp.",
        "Apply the events block on top of that snapshot to answer the user's question.",
      ]
      : ["No snapshot is present for this window, so reason directly from the events block."]),
    "Prefer the summary block for orientation, and use the events block for transaction-level reasoning.",
    ...(opts.verbose ? [] : ["This is the compact context view. Use --verbose to print the full raw event payloads."]),
    "Reclassify, correction, and confirm events are append-only audit events; use them when interpreting categories, field fixes, and review status.",
    "Amounts are signed: inflows are positive, outflows are negative for known flow types. Document types (invoice, bill) are signed by direction.",
  ];

  return {
    metadata,
    instructions,
    policy_text: opts.includePolicy ? opts.policyText : null,
    summary: summaryOut,
    snapshot: snapshot ? { ts: snapshot.ts, data: snapshot.data } : null,
    events: events.map((event) => {
      if (opts.verbose) return event;
      return {
        ts: event.ts,
        source: event.source,
        type: event.type,
        category: String(event.data.category ?? event.type),
        description: String(event.data.description ?? ""),
        amount: event.data.amount,
        currency: String(event.data.currency ?? ""),
        confidence: String(event.data.confidence ?? ""),
        id: event.id,
      };
    }),
    effective_after: effectiveAfter ?? "all",
    effective_before: opts.before ?? "now",
    verbosity: opts.verbose ? "full" : "compact",
  };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

export function buildPackData(opts: {
  all: LedgerEvent[];
  after?: string;
  before?: string;
  source?: string;
  workflow: WorkflowStatus;
  policyText?: string | null;
  generatedAt?: string;
}) {
  const events = sortByTimestamp(filter(opts.all, { after: opts.after, before: opts.before, source: opts.source }));
  const generalLedgerCsv = [
    "date,source,type,category,description,amount,currency,confidence,id",
    ...events
      .filter((event) => !META_TYPES.has(event.type))
      .map((event) => [
        event.ts.slice(0, 10),
        csvEscape(event.source),
        event.type,
        csvEscape(String(event.data.category ?? "")),
        csvEscape(String(event.data.description ?? "")),
        String(event.data.amount ?? ""),
        String(event.data.currency ?? ""),
        String(event.data.confidence ?? ""),
        event.id,
      ].join(",")),
  ].join("\n") + "\n";

  const reclassEvents = opts.all.filter((event) => event.type === "reclassify");
  const reclassificationsCsv = reclassEvents.length === 0
    ? null
    : [
      "date,original_id,new_category,new_type,reason",
      ...reclassEvents.map((event) => [
        event.ts.slice(0, 10),
        String(event.data.original_id ?? ""),
        csvEscape(String(event.data.new_category ?? "")),
        csvEscape(String(event.data.new_type ?? "")),
        csvEscape(String(event.data.reason ?? "")),
      ].join(",")),
    ].join("\n") + "\n";

  const effectiveEvents = applyReclassifications(events, opts.all);
  const reclassifyMap = buildReclassifyMap(opts.all);
  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; total: number }> = {};
  let inflows = 0;
  let outflows = 0;
  const reporting = buildReportingSections(effectiveEvents);
  const categoryRollup = buildCategoryRollup(effectiveEvents);
  const settlements = buildDocumentSettlementData(events, opts.before ?? opts.generatedAt ?? new Date().toISOString());
  const reviewMateriality = buildReviewMateriality(events, opts.all);
  const correctionSummary = buildCorrectionSummary(events);

  for (const [index, event] of events.entries()) {
    const effectiveEvent = effectiveEvents[index];
    if (META_TYPES.has(event.type)) continue;
    const amount = Number(effectiveEvent.data.amount);
    if (Number.isNaN(amount)) continue;

    const category = reclassifyMap[event.id] ?? String(effectiveEvent.data.category ?? effectiveEvent.type);
    const currency = String(effectiveEvent.data.currency ?? "UNKNOWN");

    if (!byType[effectiveEvent.type]) byType[effectiveEvent.type] = { count: 0, total: 0 };
    byType[effectiveEvent.type].count++;
    byType[effectiveEvent.type].total = round2(byType[effectiveEvent.type].total + amount);

    if (!byCategory[category]) byCategory[category] = { count: 0, total: 0 };
    byCategory[category].count++;
    byCategory[category].total = round2(byCategory[category].total + amount);

    if (!byCurrency[currency]) byCurrency[currency] = { count: 0, total: 0 };
    byCurrency[currency].count++;
    byCurrency[currency].total = round2(byCurrency[currency].total + amount);

    if (amount > 0) inflows = round2(inflows + amount);
    else outflows = round2(outflows + amount);
  }

  const summary = {
    workflow: opts.workflow,
    reporting_mode: opts.workflow.reporting_mode,
    classification_basis: opts.workflow.classification_basis,
    workflow_warning: opts.workflow.warning,
    period: { after: opts.after ?? "all", before: opts.before ?? "now" },
    by_type: byType,
    by_category: byCategory,
    by_currency: byCurrency,
    category_rollup: categoryRollup,
    cash_flow: { inflows, outflows, net: round2(inflows + outflows) },
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
    settlement_summary: settlements.settlement_summary,
    documents_by_direction: settlements.documents_by_direction,
    receivable_candidates: settlements.receivable_candidates,
    payable_candidates: settlements.payable_candidates,
    review_materiality: reviewMateriality,
    correction_summary: correctionSummary,
  };

  const assetRegister = buildAssetRegister(events, {
    asOf: opts.before ?? opts.generatedAt ?? new Date().toISOString(),
    defaultLife: 36,
  });
  const capitalizedEvents = [
    ...assetRegister.active,
    ...assetRegister.disposed,
    ...assetRegister.written_off,
  ];
  const assetRegisterCsv = capitalizedEvents.length === 0
    ? null
    : [
      "date,description,category,cost,currency,useful_life,monthly_dep,months_elapsed,acc_dep,impairment,nbv,status,proceeds,gain_loss,id",
      ...assetRegister.active.map((asset) => [
        asset.date,
        csvEscape(asset.description),
        csvEscape(asset.category),
        String(asset.cost),
        asset.currency,
        String(asset.useful_life_months),
        String(asset.monthly_depreciation),
        String(asset.months_elapsed),
        String(asset.accumulated_depreciation),
        String(asset.impairment_total),
        String(asset.net_book_value),
        "active",
        "",
        "",
        asset.id,
      ].join(",")),
      ...assetRegister.disposed.map((asset) => [
        asset.date,
        csvEscape(asset.description),
        csvEscape(asset.category),
        String(asset.cost),
        asset.currency,
        String(asset.useful_life_months),
        String(asset.monthly_depreciation),
        String(asset.months_elapsed),
        String(asset.accumulated_depreciation),
        String(asset.impairment_total),
        "0",
        "disposed",
        String(asset.proceeds),
        String(asset.gain_loss),
        asset.id,
      ].join(",")),
      ...assetRegister.written_off.map((asset) => [
        asset.date,
        csvEscape(asset.description),
        csvEscape(asset.category),
        String(asset.cost),
        asset.currency,
        String(asset.useful_life_months),
        String(asset.monthly_depreciation),
        String(asset.months_elapsed),
        String(asset.accumulated_depreciation),
        String(asset.impairment_total),
        "0",
        "written_off",
        "",
        String(asset.loss),
        asset.id,
      ].join(",")),
    ].join("\n") + "\n";

  const hash = createHash("sha256").update(events.map((event) => event.id).join(",")).digest("hex");
  let debits = 0;
  let credits = 0;
  const issues: string[] = [];
  for (const event of events) {
    const amount = Number(event.data.amount);
    if (event.data.amount !== undefined && !Number.isNaN(amount)) {
      if (amount < 0) debits = round2(debits + amount);
      else credits = round2(credits + amount);
      if (OUTFLOW_TYPES.has(event.type) && amount > 0) issues.push(`${event.id}: outflow "${event.type}" positive ${amount}`);
      if (INFLOW_TYPES.has(event.type) && amount < 0) issues.push(`${event.id}: inflow "${event.type}" negative ${amount}`);
    }
  }

  const verify = {
    workflow: opts.workflow,
    reporting_mode: opts.workflow.reporting_mode,
    classification_basis: opts.workflow.classification_basis,
    workflow_warning: opts.workflow.warning,
    event_count: events.length,
    debits,
    credits,
    hash,
    issues,
    correction_summary: buildCorrectionSummary(events),
    generated: opts.generatedAt ?? new Date().toISOString(),
  };

  const correctionEvents = opts.all.filter((event) => event.type === "correction");
  const correctionsCsv = correctionEvents.length === 0
    ? null
    : [
      "date,original_id,reason,corrected_fields,id",
      ...correctionEvents.map((event) => [
        event.ts.slice(0, 10),
        String(event.data.original_id ?? ""),
        csvEscape(String(event.data.reason ?? "")),
        csvEscape(JSON.stringify(event.data.corrected_fields ?? {})),
        event.id,
      ].join(",")),
    ].join("\n") + "\n";

  const confirmEvents = opts.all.filter((event) => event.type === "confirm");
  const confirmationsCsv = confirmEvents.length === 0
    ? null
    : [
      "date,original_id,confidence,confirmed_by,notes,id",
      ...confirmEvents.map((event) => [
        event.ts.slice(0, 10),
        String(event.data.original_id ?? ""),
        csvEscape(String(event.data.confidence ?? "")),
        csvEscape(String(event.data.confirmed_by ?? event.data.recorded_by ?? "")),
        csvEscape(String(event.data.notes ?? "")),
        event.id,
      ].join(",")),
    ].join("\n") + "\n";

  const fileNames = ["general_ledger.csv", "summary.json", "verify.json"];
  if (reclassificationsCsv) fileNames.push("reclassifications.csv");
  if (correctionsCsv) fileNames.push("corrections.csv");
  if (confirmationsCsv) fileNames.push("confirmations.csv");
  if (assetRegisterCsv) fileNames.push("asset_register.csv");
  if (opts.policyText !== undefined && opts.policyText !== null) fileNames.push("policy.md");
  fileNames.push("workflow.json");

  return {
    period: { after: opts.after ?? "all", before: opts.before ?? "now" },
    events: events.length,
    file_names: fileNames,
    general_ledger_csv: generalLedgerCsv,
    reclassifications_csv: reclassificationsCsv,
    summary,
    asset_register_csv: assetRegisterCsv,
    verify,
    policy_markdown: opts.policyText ?? null,
    corrections_csv: correctionsCsv,
    confirmations_csv: confirmationsCsv,
    workflow: opts.workflow,
  };
}

export function buildDiagnostics(params: {
  booksDir: string | null;
  ledgerPath: string;
  policyPath: string;
  resolution: string;
  cliVersion: string;
  cwd: string;
  booksExist: boolean;
  ledgerExists: boolean;
  policyExists: boolean;
  canRead: boolean;
  canWrite: boolean;
  support: {
    program_path: string;
    agent_bootstrap_path: string;
    event_schema_path: string;
    exists: {
      program: boolean;
      agent_bootstrap: boolean;
      event_schema: boolean;
    };
  };
  program: {
    path: string;
    source: "books" | "package";
    exists: boolean;
  };
  availableExamples: string[];
  workflow: WorkflowStatus;
  all: LedgerEvent[];
  policyText: string;
  latestSession: ImportSessionSummary | null;
  importsDir: string | null;
  importSessionsDir: string | null;
}) {
  const policyReadiness = classifyPolicyReadiness(params.policyText, params.policyPath);
  const lint = lintPolicyText(params.policyText, params.policyPath);
  const verification = params.ledgerExists ? analyzeVerification(params.all) : null;
  const nonMetaEvents = params.all.filter((event) => !META_TYPES.has(event.type));
  const openingBalances = params.all.filter((event) => event.type === "opening_balance");
  const snapshots = params.all.filter((event) => event.type === "snapshot");
  const latestLedgerSnapshot = latestSnapshot(params.all);
  const latestEventTs = params.all.length > 0 ? params.all[params.all.length - 1].ts : null;
  const latestNonSnapshotTs = [...params.all].reverse().find((event) => event.type !== "snapshot")?.ts ?? null;
  const provenanceKeys = ["ref", "source_doc", "source_row", "source_hash", "provenance"];
  const eventsWithoutProvenance = nonMetaEvents.filter((event) => provenanceKeys.every((key) => event.data[key] === undefined));
  const duplicateGroups = verification?.potential_duplicates?.length ?? 0;
  const chainValid = verification?.chain_valid ?? null;
  const issueCount = verification?.issues.length ?? 0;
  const reviewMateriality = buildReviewMateriality(nonMetaEvents, params.all);
  const reviewQueueCount = reviewMateriality.by_confidence.unclear.count
    + reviewMateriality.by_confidence.inferred.count
    + reviewMateriality.by_confidence.unset.count;
  const reviewQueueMagnitude = reviewMateriality.by_confidence.unclear.magnitude
    + reviewMateriality.by_confidence.inferred.magnitude
    + reviewMateriality.by_confidence.unset.magnitude;
  const materiallyLargeReviewQueue = reviewQueueCount >= 3
    || reviewQueueMagnitude >= 1000
    || reviewMateriality.by_confidence.unclear.count > 0;

  let snapshotStatus = "none";
  let snapshotReason = "No snapshot events found in the ledger.";
  if (latestLedgerSnapshot && latestNonSnapshotTs) {
    if (latestLedgerSnapshot.ts >= latestNonSnapshotTs) {
      snapshotStatus = "current";
      snapshotReason = "A snapshot exists at or after the latest non-snapshot event.";
    } else {
      snapshotStatus = "stale";
      snapshotReason = "A snapshot exists, but newer non-snapshot events were added after it.";
    }
  } else if (latestLedgerSnapshot) {
    snapshotStatus = "current";
    snapshotReason = "Only snapshot events are present in the ledger.";
  }

  const operatorWarnings: string[] = [];
  if (params.ledgerExists && params.all.length === 0) {
    operatorWarnings.push("Ledger exists but is empty. Import events before relying on reports.");
  }
  if (params.ledgerExists && nonMetaEvents.length > 0 && openingBalances.length === 0 && snapshots.length === 0) {
    operatorWarnings.push("No opening_balance or snapshot events found. Balance-sheet style outputs may be incomplete.");
  }
  if (eventsWithoutProvenance.length > 0) {
    operatorWarnings.push(`${eventsWithoutProvenance.length} non-meta events have no provenance fields such as data.ref, data.source_doc, or data.source_hash.`);
  }
  if (duplicateGroups > 0) {
    operatorWarnings.push(`${duplicateGroups} potential duplicate group(s) detected. Review verify output before reporting.`);
  }
  if (policyReadiness.provisional) {
    operatorWarnings.push("Policy is still starter/provisional. External outputs should be marked provisional.");
  }
  if (snapshotStatus === "none" && nonMetaEvents.length >= 25) {
    operatorWarnings.push("No snapshot has been saved yet. Consider `clawbooks snapshot <period> --save` after a reporting run.");
  }
  if (snapshotStatus === "stale") {
    operatorWarnings.push("Snapshot is stale relative to the latest ledger activity.");
  }
  if (params.latestSession && params.latestSession.status !== "ok") {
    operatorWarnings.push("Latest saved import session is not clean. Re-run `clawbooks import check` before relying on reporting.");
  }
  if (nonMetaEvents.length > 0 && !params.latestSession) {
    operatorWarnings.push("No saved import session was found. Reporting can proceed, but import validation history is missing.");
  }
  if (materiallyLargeReviewQueue) {
    operatorWarnings.push("Review queue is materially open. Confirm or reclassify high-impact inferred items before final reporting.");
  }

  let reportingReadiness: "blocked" | "caution" | "ready" = params.workflow.reporting_readiness;
  const readinessReasons: string[] = [];
  if (params.workflow.reporting_readiness === "blocked") {
    readinessReasons.push("program.md or policy.md is missing.");
  }
  if (params.workflow.reporting_readiness !== "blocked" && params.workflow.reporting_readiness !== "ready") {
    readinessReasons.push("program.md and policy.md are not acknowledged for the current run.");
  }
  if (policyReadiness.provisional) {
    reportingReadiness = "caution";
    readinessReasons.push("policy.md is still starter/provisional.");
  }
  if (issueCount > 0 || chainValid === false) {
    reportingReadiness = "caution";
    readinessReasons.push("ledger verification reports open integrity issues.");
  }
  if (nonMetaEvents.length > 0 && !params.latestSession) {
    reportingReadiness = "caution";
    readinessReasons.push("no saved import-check session is available for current data.");
  }
  if (params.latestSession && (params.latestSession.status !== "ok" || params.latestSession.workflow_acknowledged === false)) {
    reportingReadiness = "caution";
    readinessReasons.push("latest import session is mismatched or was saved without workflow acknowledgment.");
  }
  if (materiallyLargeReviewQueue) {
    reportingReadiness = "caution";
    readinessReasons.push("review queue still contains material unresolved items.");
  }

  const effectiveClassificationBasis = params.latestSession?.classification_basis ?? params.workflow.classification_basis;
  const effectiveReportingMode = deriveReportingMode(reportingReadiness, String(effectiveClassificationBasis));
  const suggestedNextCommand = !params.ledgerExists && !params.policyExists
    ? "clawbooks quickstart"
    : params.workflow.reporting_readiness !== "ready"
      ? "clawbooks workflow ack --program --policy"
      : !params.latestSession || params.latestSession.status !== "ok"
        ? "clawbooks import check ... --save-session"
        : materiallyLargeReviewQueue
          ? "clawbooks review"
          : "clawbooks summary";

  const hasSupportFiles = params.support.exists.program && params.support.exists.agent_bootstrap && params.support.exists.event_schema;

  return {
    command: "doctor",
    cli_version: params.cliVersion,
    cwd: params.cwd,
    resolved_books: {
      books_dir: params.booksDir,
      ledger_path: params.ledgerPath,
      policy_path: params.policyPath,
      resolution: params.resolution,
      exists: {
        books_dir: params.booksExist,
        ledger: params.ledgerExists,
        policy: params.policyExists,
      },
    },
    package_support: {
      ...params.support,
      resolved_program: params.program,
      available_examples: params.availableExamples,
    },
    status: {
      initialized: params.ledgerExists || params.policyExists,
      can_read_books: params.canRead,
      can_write_books: params.canWrite,
      support_files_present: hasSupportFiles,
    },
    workflow: {
      ...params.workflow,
      reporting_readiness: reportingReadiness,
      reporting_mode: effectiveReportingMode,
      classification_basis: effectiveClassificationBasis,
      readiness_reasons: readinessReasons,
    },
    ledger_health: !params.ledgerExists ? {
      present: false,
    } : {
      present: true,
      event_count: params.all.length,
      non_meta_event_count: nonMetaEvents.length,
      chain_valid: chainValid,
      verification_issue_count: issueCount,
      potential_duplicate_groups: duplicateGroups,
      hash: verification?.hash,
      first_event_ts: params.all[0]?.ts ?? null,
      last_event_ts: latestEventTs,
    },
    snapshot_health: {
      count: snapshots.length,
      latest_ts: latestLedgerSnapshot?.ts ?? null,
      status: snapshotStatus,
      reason: snapshotReason,
    },
    diagnostics: {
      policy: {
        path: params.policyPath,
        exists: params.policyExists,
        readiness: policyReadiness.status,
        provisional_outputs: policyReadiness.provisional,
        reason: policyReadiness.reason,
        lint_status: lint.status,
        lint_issue_count: lint.issues.length,
        lint_suggestion_count: lint.suggestions.length,
        top_issues: lint.issues.slice(0, 3),
        top_suggestions: lint.suggestions.slice(0, 3),
      },
      support_files: {
        program: params.program.exists ? "ok" : "missing",
        agent_bootstrap: params.support.exists.agent_bootstrap ? "ok" : "missing",
        event_schema: params.support.exists.event_schema ? "ok" : "missing",
      },
      ledger_integrity: verification ? {
        chain_valid: verification.chain_valid,
        issue_count: verification.issues.length,
        top_issues: verification.issues.slice(0, 5),
        potential_duplicates: verification.potential_duplicates ?? [],
      } : null,
      operator_mistakes: {
        warning_count: operatorWarnings.length,
        warnings: operatorWarnings,
      },
      import_workflow: {
        import_scaffolds_dir: params.importsDir,
        import_sessions_dir: params.importSessionsDir,
        latest_session: params.latestSession,
        recommendations: [
          "Use `clawbooks import scaffold <kind>` when starting a new importer.",
          "Use `clawbooks import check ... --statement ... --save-session` before appending staged statement imports.",
          "Use `clawbooks import sessions list` to inspect prior staged import runs.",
          "Use `clawbooks import reconcile <events.jsonl> --statement profile.json` to produce a statement reconciliation artifact.",
          "Use `clawbooks import mappings suggest` or `clawbooks import mappings check` only as optional factual consistency aids.",
          "Prefer importing full source coverage when practical and applying report periods later.",
          "Keep vendor mappings near the scaffold or in .books/vendor-mappings.json so import check can discover them.",
        ],
      },
      review_queue: {
        count: reviewQueueCount,
        materially_large: materiallyLargeReviewQueue,
        materiality: reviewMateriality,
      },
    },
    suggested_next_command: suggestedNextCommand,
    notes: [
      "Use `clawbooks quickstart` for workflow guidance, core file roles, and reporting capabilities.",
      params.workflow.reporting_readiness === "ready"
        ? "Workflow acknowledgment is current for program.md and policy.md."
        : "Workflow acknowledgment is missing or stale. Next best command: `clawbooks workflow ack --program --policy`.",
      params.support.exists.event_schema
        ? "Schema reference present: event-schema.md is packaged and available."
        : "Schema reference missing: event-schema.md was not found in package support files.",
      !params.ledgerExists && !params.policyExists
        ? "No books were found yet. Run `clawbooks init` or point clawbooks at an existing books directory."
        : "Books were resolved successfully. Review the policy diagnostics above before relying on outputs.",
    ],
    agent_bootstrap: {
      prompt_file: params.support.agent_bootstrap_path,
    },
  };
}

export type StatementProfile = {
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

export type VendorMapping = {
  match: string;
  type?: string;
  category?: string;
  confidence?: string;
  notes?: string;
};

export function descriptionOf(event: LedgerEvent): string | null {
  const value = event.data.description;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeVendorText(value: string): string {
  return value
    .toUpperCase()
    .replace(/\d+/g, "#")
    .replace(/[^A-Z#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countMapEntries(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function topEntry(counts: Record<string, number>): { value: string; count: number } | null {
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return entries[0] ? { value: entries[0][0], count: entries[0][1] } : null;
}

export function distinctCount(counts: Record<string, number>): number {
  return Object.keys(counts).length;
}

export function matchingMapping(description: string, mappings: VendorMapping[]): VendorMapping | null {
  const normalizedDescription = normalizeVendorText(description);
  const sorted = mappings
    .filter((mapping) => typeof mapping.match === "string" && mapping.match.trim())
    .slice()
    .sort((left, right) => normalizeVendorText(right.match).length - normalizeVendorText(left.match).length);
  return sorted.find((mapping) => normalizedDescription.includes(normalizeVendorText(mapping.match))) ?? null;
}

export function vendorHistory(events: LedgerEvent[]) {
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

export function stableHistorySummary(history: ReturnType<typeof vendorHistory>[string]) {
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

export function mappingDiagnostics(events: LedgerEvent[], mappings: VendorMapping[], ledgerHistoryEvents: LedgerEvent[]) {
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
      if ((mapping.type && event.type !== mapping.type)
        || (mapping.category && category && category !== mapping.category)
        || (mapping.confidence && confidence && confidence !== mapping.confidence)) {
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

export function suggestMappings(events: LedgerEvent[], existingMappings: VendorMapping[], minOccurrences: number) {
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
    .sort((left, right) => right.count - left.count || left.normalized_vendor.localeCompare(right.normalized_vendor));

  return {
    total_candidates: suggestions.length,
    uncovered_candidates: suggestions.filter((item) => !item.already_covered).length,
    suggestions,
  };
}

export function validateMappingsFile(mappings: VendorMapping[]) {
  const duplicateMatches = Object.entries(countMapEntries(mappings.map((mapping) => normalizeVendorText(mapping.match))))
    .filter(([, count]) => count > 1)
    .map(([match, count]) => ({ normalized_match: match, count }));
  const overlaps: Array<{ match: string; overlaps_with: string }> = [];
  const normalized = mappings
    .map((mapping) => ({ raw: mapping.match, normalized: normalizeVendorText(mapping.match) }))
    .filter((mapping) => mapping.normalized);

  for (let left = 0; left < normalized.length; left++) {
    for (let right = left + 1; right < normalized.length; right++) {
      if (normalized[left].normalized === normalized[right].normalized) continue;
      if (normalized[left].normalized.includes(normalized[right].normalized)
        || normalized[right].normalized.includes(normalized[left].normalized)) {
        overlaps.push({ match: normalized[left].raw, overlaps_with: normalized[right].raw });
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

export function sumBySign(events: LedgerEvent[]): { debits: number; credits: number; net: number } {
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

export function eventCountsByType(events: LedgerEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    out[event.type] = (out[event.type] ?? 0) + 1;
  }
  return out;
}

export function provenanceCoverage(events: LedgerEvent[]) {
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

export function dateCoverage(events: LedgerEvent[]) {
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

export function orderingProfile(events: LedgerEvent[], basis: DateBasis) {
  const values = events
    .map((event) => {
      if (basis === "ledger") return event.ts;
      const value = basis === "transaction" ? event.data.transaction_date : event.data.posting_date;
      return typeof value === "string" ? value : null;
    })
    .filter((value): value is string => Boolean(value));

  let asc = true;
  let desc = true;
  for (let index = 1; index < values.length; index++) {
    if (values[index] < values[index - 1]) asc = false;
    if (values[index] > values[index - 1]) desc = false;
  }

  return {
    basis,
    order: asc ? "ascending" : desc ? "descending" : "mixed",
    event_count_with_basis: values.length,
  } as const;
}

export function duplicateRefs(events: LedgerEvent[]): string[] {
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

export function dateRange(events: LedgerEvent[], basis: DateBasis): { first: string | null; last: string | null } {
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

export function buildImportReconciliation(opts: {
  inputPath: string;
  ledgerPath: string;
  rawEvents: LedgerEvent[];
  allLedger: LedgerEvent[];
  profile: StatementProfile;
  dateBasis: DateBasis;
  currency?: string;
  statementStart?: string;
  statementEnd?: string;
}) {
  if (!["ledger", "transaction", "posting"].includes(opts.dateBasis)) {
    throw new Error("Invalid --date-basis. Use ledger, transaction, or posting.");
  }

  let stagedEvents = opts.rawEvents;
  const currency = opts.currency ?? opts.profile.currency;
  if (currency) stagedEvents = stagedEvents.filter((event) => String(event.data.currency) === currency);
  if (opts.profile.source) stagedEvents = stagedEvents.filter((event) => event.source === opts.profile.source);
  const sortedStaged = sortByTimestamp(stagedEvents);
  const statementStart = opts.statementStart ?? opts.profile.statement_start;
  const statementEnd = opts.statementEnd ?? opts.profile.statement_end;
  const stagedByBasis = filterByDateBasis(sortedStaged, {
    after: statementStart ? `${statementStart}T00:00:00.000Z` : undefined,
    before: statementEnd ? `${statementEnd}T23:59:59.999Z` : undefined,
    basis: opts.dateBasis,
  });
  const scopedStaged = stagedByBasis.events;
  const stagedTotals = sumBySign(scopedStaged);

  let imported = opts.allLedger;
  if (opts.profile.source) imported = imported.filter((event) => event.source === opts.profile.source);
  if (currency) imported = imported.filter((event) => String(event.data.currency) === currency);
  const importedByBasis = filterByDateBasis(sortByTimestamp(imported), {
    after: statementStart ? `${statementStart}T00:00:00.000Z` : undefined,
    before: statementEnd ? `${statementEnd}T23:59:59.999Z` : undefined,
    basis: opts.dateBasis,
  });
  const importedScoped = importedByBasis.events;
  const importedTotals = sumBySign(importedScoped);

  const skippedRows = Math.max(0, sortedStaged.length - scopedStaged.length - stagedByBasis.missingBasisIds.length);
  const expectedClosing = opts.profile.closing_balance ?? null;
  const expectedOpening = opts.profile.opening_balance ?? null;
  const stagedClosing = expectedOpening !== null ? round2(Number(expectedOpening) + stagedTotals.net) : null;
  const importedClosing = expectedOpening !== null ? round2(Number(expectedOpening) + importedTotals.net) : null;
  const unexplainedDeltas = {
    count: importedScoped.length - scopedStaged.length,
    debits: round2(importedTotals.debits - stagedTotals.debits),
    credits: round2(importedTotals.credits - stagedTotals.credits),
    net_movement: round2(importedTotals.net - stagedTotals.net),
    closing_balance: expectedClosing !== null && importedClosing !== null ? round2(importedClosing - Number(expectedClosing)) : null,
  };
  const statementAligned = Math.abs(unexplainedDeltas.count) === 0
    && Math.abs(unexplainedDeltas.debits) < 0.01
    && Math.abs(unexplainedDeltas.credits) < 0.01
    && Math.abs(unexplainedDeltas.net_movement) < 0.01
    && (unexplainedDeltas.closing_balance === null || Math.abs(unexplainedDeltas.closing_balance) < 0.01);

  return {
    command: "import reconcile",
    workflow_state: statementAligned ? "statement_aligned" : "needs_reconciliation",
    what_matters: "This statement reconciliation artifact compares the staged import, the current ledger slice, and the declared statement expectations.",
    statement: {
      statement_id: opts.profile.statement_id ?? null,
      source: opts.profile.source ?? null,
      currency: currency ?? null,
      date_basis: opts.dateBasis,
      statement_start: statementStart ?? null,
      statement_end: statementEnd ?? null,
      opening_balance: expectedOpening,
      closing_balance: expectedClosing,
      newest_first: opts.profile.newest_first ?? null,
    },
    staged: {
      input_path: opts.inputPath,
      row_count: sortedStaged.length,
      scoped_row_count: scopedStaged.length,
      missing_date_basis_events: stagedByBasis.missingBasisIds.length,
      skipped_rows: skippedRows,
      debits: stagedTotals.debits,
      credits: stagedTotals.credits,
      net_movement: stagedTotals.net,
      closing_balance: stagedClosing,
      first_date: dateRange(scopedStaged, opts.dateBasis).first,
      last_date: dateRange(scopedStaged, opts.dateBasis).last,
    },
    imported: {
      ledger_path: opts.ledgerPath,
      row_count: importedScoped.length,
      missing_date_basis_events: importedByBasis.missingBasisIds.length,
      debits: importedTotals.debits,
      credits: importedTotals.credits,
      net_movement: importedTotals.net,
      closing_balance: importedClosing,
      first_date: dateRange(importedScoped, opts.dateBasis).first,
      last_date: dateRange(importedScoped, opts.dateBasis).last,
    },
    unexplained_deltas: unexplainedDeltas,
    next_best_command: statementAligned ? "clawbooks review" : "clawbooks import check",
  };
}

export function buildImportCheck(opts: {
  inputPath: string;
  statementProfilePath: string | null;
  rawEvents: LedgerEvent[];
  ledgerHistoryEvents: LedgerEvent[];
  workflow: WorkflowStatus;
  profile: StatementProfile;
  dateBasis: DateBasis;
  currency?: string;
  sourceFilter?: string | null;
  mappings: {
    checkedPaths: string[];
    path: string | null;
    issues: string[];
    mappings: VendorMapping[];
  };
  classificationBasis?: string;
  mapperPath?: string | null;
  recordedBy?: string | null;
  statementStart?: string;
  statementEnd?: string;
}) {
  if (!["ledger", "transaction", "posting"].includes(opts.dateBasis)) {
    throw new Error("Invalid --date-basis. Use ledger, transaction, or posting.");
  }

  let rawFilteredEvents = opts.rawEvents;
  const currency = opts.currency ?? opts.profile.currency;
  if (currency) rawFilteredEvents = rawFilteredEvents.filter((event) => String(event.data.currency) === currency);
  if (opts.profile.source) rawFilteredEvents = rawFilteredEvents.filter((event) => event.source === opts.profile.source);
  const events = sortByTimestamp(rawFilteredEvents);

  const statementStart = opts.statementStart ?? opts.profile.statement_start;
  const statementEnd = opts.statementEnd ?? opts.profile.statement_end;
  const filteredByBasis = filterByDateBasis(events, {
    after: statementStart ? `${statementStart}T00:00:00.000Z` : undefined,
    before: statementEnd ? `${statementEnd}T23:59:59.999Z` : undefined,
    basis: opts.dateBasis,
  });
  const rawFilteredByBasis = filterByDateBasis(rawFilteredEvents, {
    after: statementStart ? `${statementStart}T00:00:00.000Z` : undefined,
    before: statementEnd ? `${statementEnd}T23:59:59.999Z` : undefined,
    basis: opts.dateBasis,
  });
  const scopedEvents = filteredByBasis.events;
  const outOfPeriodCount = events.length - scopedEvents.length - filteredByBasis.missingBasisIds.length;
  const totals = sumBySign(scopedEvents);
  const range = dateRange(scopedEvents, opts.dateBasis);
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
  const mappingsReport = {
    available: opts.mappings.path !== null,
    path: opts.mappings.path,
    file_issues: opts.mappings.issues,
    file_checks: validateMappingsFile(opts.mappings.mappings),
    diagnostics: mappingDiagnostics(rawFilteredEvents, opts.mappings.mappings, opts.ledgerHistoryEvents),
  };

  if (opts.profile.count !== undefined) {
    expected.count = Number(opts.profile.count);
    differences.count = scopedEvents.length - Number(expected.count);
    if (differences.count !== 0) issues.push(`Count mismatch: expected ${expected.count}, got ${scopedEvents.length}`);
  }
  if (opts.profile.debits !== undefined) {
    expected.debits = Number(opts.profile.debits);
    differences.debits = round2(totals.debits - Number(expected.debits));
    if (Math.abs(differences.debits) > 0.01) issues.push(`Debits mismatch: expected ${expected.debits}, got ${totals.debits}`);
  }
  if (opts.profile.credits !== undefined) {
    expected.credits = Number(opts.profile.credits);
    differences.credits = round2(totals.credits - Number(expected.credits));
    if (Math.abs(differences.credits) > 0.01) issues.push(`Credits mismatch: expected ${expected.credits}, got ${totals.credits}`);
  }
  if (opts.profile.opening_balance !== undefined) {
    expected.opening_balance = Number(opts.profile.opening_balance);
    actual.opening_balance = Number(expected.opening_balance);
  }
  if (opts.profile.closing_balance !== undefined) {
    expected.closing_balance = Number(opts.profile.closing_balance);
    actual.closing_balance = round2(Number(actual.opening_balance ?? 0) + totals.net);
    differences.closing_balance = round2(Number(actual.closing_balance) - Number(expected.closing_balance));
    if (Math.abs(differences.closing_balance) > 0.01) {
      issues.push(`Closing balance mismatch: expected ${expected.closing_balance}, got ${actual.closing_balance}`);
    }
  }
  if (statementStart) {
    expected.statement_start = statementStart;
    if (range.first && range.first < statementStart) {
      issues.push(`First ${opts.dateBasis} date ${range.first} falls before statement_start ${statementStart}`);
    }
  }
  if (statementEnd) {
    expected.statement_end = statementEnd;
    if (range.last && range.last > statementEnd) {
      issues.push(`Last ${opts.dateBasis} date ${range.last} falls after statement_end ${statementEnd}`);
    }
  }
  if (outOfPeriodCount > 0) {
    issues.push(`${outOfPeriodCount} staged event(s) fall outside the requested statement period and were excluded from scoped checks.`);
  }
  if (opts.profile.newest_first === true && orderingProfile(rawFilteredEvents, opts.dateBasis).order !== "descending") {
    issues.push(`Statement profile says newest_first=true, but the staged file appears ${orderingProfile(rawFilteredEvents, opts.dateBasis).order} by ${opts.dateBasis} date after source/currency filtering.`);
  }
  if (opts.profile.newest_first === false && orderingProfile(rawFilteredEvents, opts.dateBasis).order !== "ascending") {
    issues.push(`Statement profile says newest_first=false, but the staged file appears ${orderingProfile(rawFilteredEvents, opts.dateBasis).order} by ${opts.dateBasis} date after source/currency filtering.`);
  }

  const provenance = provenanceCoverage(scopedEvents);
  const dates = dateCoverage(scopedEvents);
  const filteredOrdering = orderingProfile(rawFilteredEvents, opts.dateBasis);
  const scopedOrdering = orderingProfile(rawFilteredByBasis.events, opts.dateBasis);
  const duplicateRefList = duplicateRefs(scopedEvents);
  const passedChecks = [
    ...(expected.count !== undefined && !issues.some((issue) => issue.startsWith("Count mismatch")) ? ["count"] : []),
    ...(expected.debits !== undefined && !issues.some((issue) => issue.startsWith("Debits mismatch")) ? ["debits"] : []),
    ...(expected.credits !== undefined && !issues.some((issue) => issue.startsWith("Credits mismatch")) ? ["credits"] : []),
    ...(expected.opening_balance !== undefined ? ["opening_balance"] : []),
    ...(expected.closing_balance !== undefined && !issues.some((issue) => issue.startsWith("Closing balance mismatch")) ? ["closing_balance"] : []),
    ...(outOfPeriodCount === 0 ? ["statement_window"] : []),
    ...(duplicateRefList.length === 0 ? ["duplicate_refs"] : []),
    ...(filteredByBasis.missingBasisIds.length === 0 ? ["date_basis_coverage"] : []),
  ];
  const sourceCoverage = {
    raw_input_events: opts.rawEvents.length,
    filtered_events: events.length,
    scoped_events: scopedEvents.length,
    first_scoped_date: range.first,
    last_scoped_date: range.last,
    source_filter: opts.profile.source ?? opts.sourceFilter ?? null,
    statement_window: {
      start: statementStart ?? null,
      end: statementEnd ?? null,
    },
  };
  const assumptions = [
    `Date basis: ${opts.dateBasis}`,
    `Currency filter: ${currency ?? "none"}`,
    `Source filter: ${opts.profile.source ?? opts.sourceFilter ?? "none"}`,
    `Mappings path used: ${opts.mappings.path ?? "none found"}`,
  ];
  const sourceShapeHint = statementStart || statementEnd || opts.profile.opening_balance !== undefined || opts.profile.closing_balance !== undefined
    ? "statement_like"
    : "generic_event_export";
  const classificationBasis = opts.classificationBasis
    ?? (opts.workflow.reporting_readiness === "ready"
      ? "policy_guided"
      : opts.mapperPath || opts.mappings.path
        ? "heuristic_pattern"
        : opts.recordedBy
          ? "manual_operator"
          : "unknown");

  if (!VALID_CLASSIFICATION_BASES.has(classificationBasis)) {
    throw new Error("Invalid --classification-basis. Use policy_explicit, policy_guided, heuristic_pattern, manual_operator, mixed, or unknown.");
  }

  const reportingMode = deriveReportingMode(opts.workflow.reporting_readiness, classificationBasis);

  return {
    command: "import check",
    workflow: opts.workflow,
    reporting_mode: reportingMode,
    classification_basis: classificationBasis,
    workflow_warning: opts.workflow.warning,
    input_path: opts.inputPath,
    statement_profile_path: opts.statementProfilePath,
    statement_profile: Object.keys(opts.profile).length > 0 ? opts.profile : null,
    date_basis: opts.dateBasis,
    currency: currency ?? null,
    expected,
    actual,
    differences,
    status: issues.length === 0 ? "ok" : "mismatch",
    workflow_state: issues.length === 0 ? "ready_to_append" : "needs_mapper_or_profile_adjustment",
    what_matters: issues.length === 0
      ? "The staged import matches the active checks. Review once more, then append."
      : "The staged import does not yet match the active checks. Fix the mapper or statement assumptions before append.",
    source_shape_hint: sourceShapeHint,
    passed_checks: [...new Set(passedChecks)],
    blocking_issues: issues,
    assumptions,
    next_best_command: issues.length === 0
      ? "clawbooks batch < staged.jsonl"
      : "clawbooks import check staged.jsonl --statement statement-profile.json",
    issues,
    missing_date_basis_events: filteredByBasis.missingBasisIds,
    out_of_period_events: outOfPeriodCount,
    input_event_count: opts.rawEvents.length,
    filtered_event_count: events.length,
    source_coverage: sourceCoverage,
    event_types: eventCountsByType(scopedEvents),
    provenance_coverage: provenance,
    date_coverage: dates,
    mapping_diagnostics: {
      ...mappingsReport,
      discovery: {
        checked_paths: opts.mappings.checkedPaths,
        used_path: opts.mappings.path,
      },
    },
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
  };
}

export type { LedgerEvent } from "./ledger.js";
export type { AssetBaseRecord, DisposedAssetRecord, WrittenOffAssetRecord, AssetRegister } from "./assets.js";
export type { DateBasis } from "./imports.js";
