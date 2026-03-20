import { filter, readAll, type LedgerEvent } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildConfirmedSet, buildReviewMateriality } from "../review.js";
import { META_TYPES } from "../event-types.js";
import { sortByTimestamp } from "../reporting.js";

export function cmdReview(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(ledgerPath);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));
  const minMagnitude = f["min-magnitude"] !== undefined ? Number(f["min-magnitude"]) : null;
  const requestedConfidence = f.confidence ? new Set(f.confidence.split(",").map((value) => value.trim()).filter(Boolean)) : null;
  const limit = f.limit !== undefined ? parseInt(f.limit) : null;
  const groupBy = f["group-by"] ?? null;

  const reclassified = new Set(
    all.filter((e) => e.type === "reclassify").map((e) => String(e.data.original_id)),
  );
  const confirmed = buildConfirmedSet(all);

  const reviewable = events
    .filter((e) => !META_TYPES.has(e.type))
    .filter((e) => !reclassified.has(e.id))
    .filter((e) => !confirmed.has(e.id));

  const tiers: Record<string, LedgerEvent[]> = { unclear: [], inferred: [], unset: [] };

  for (const e of reviewable) {
    const confidence = String(e.data.confidence ?? "unset");
    if (confidence === "clear") continue;
    const amount = Number(e.data.amount);
    if (minMagnitude !== null && Number.isFinite(amount) && Math.abs(amount) < minMagnitude) continue;
    if (requestedConfidence && !requestedConfidence.has(confidence)) continue;
    if (confidence === "unclear") tiers.unclear.push(e);
    else if (confidence === "inferred") tiers.inferred.push(e);
    else tiers.unset.push(e);
  }

  let items = [...tiers.unclear, ...tiers.inferred, ...tiers.unset];
  if (limit !== null) items = items.slice(0, limit);
  const needs_review = items.length;
  const reviewMateriality = buildReviewMateriality(events, all);
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
  const groups = groupBy && validGroupBy.has(groupBy)
    ? items.reduce((acc, event) => {
      const key = String(groupBy === "source" ? event.source : groupBy === "type" ? event.type : event.data.category ?? "uncategorized");
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
    return {
      id: event.id,
      confidence: String(event.data.confidence ?? "unset"),
      amount: Number(event.data.amount),
      category,
      confirm_command: `clawbooks record '${JSON.stringify({ source: "manual", type: "confirm", data: { original_id: event.id, confidence: "clear", confirmed_by: "reviewer", notes: "replace with review note" } })}'`,
      reclassify_command: `clawbooks record '${JSON.stringify({ source: "manual", type: "reclassify", data: { original_id: event.id, new_category: category } })}'`,
    };
  });
  const queueSummary = {
    highest_confidence_risk: items[0]?.id ?? null,
    suggested_order: items.map((event) => event.id),
    total_visible_items: items.length,
  };

  console.log(JSON.stringify({
    needs_review,
    filters: {
      confidence: requestedConfidence ? [...requestedConfidence] : null,
      min_magnitude: minMagnitude,
      limit,
      group_by: groupBy,
    },
    by_confidence: {
      unclear: tiers.unclear.length,
      inferred: tiers.inferred.length,
      unset: tiers.unset.length,
    },
    materiality: {
      full_queue: reviewMateriality,
      filtered_queue: filteredMateriality,
    },
    queue: queueSummary,
    groups,
    next_actions: nextActions,
    items,
  }, null, 2));
}
