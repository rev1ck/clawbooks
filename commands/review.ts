import { writeFileSync } from "node:fs";
import { filter, readAll, type LedgerEvent } from "../ledger.js";
import { flags, periodFromArgs, positional } from "../cli-helpers.js";
import { buildConfirmedSet, buildReviewMateriality } from "../review.js";
import { META_TYPES } from "../event-types.js";
import { sortByTimestamp } from "../reporting.js";

function visibleReviewItems(args: string[], ledgerPath: string): {
  items: LedgerEvent[];
  visibleTiers: Record<string, LedgerEvent[]>;
  fullTiers: Record<string, LedgerEvent[]>;
  events: LedgerEvent[];
  all: LedgerEvent[];
  filters: {
    confidence: string[] | null;
    min_magnitude: number | null;
    limit: number | null;
    group_by: string | null;
  };
} {
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
  const visibleIds = new Set(items.map((event) => event.id));
  const visibleTiers: Record<string, LedgerEvent[]> = {
    unclear: tiers.unclear.filter((event) => visibleIds.has(event.id)),
    inferred: tiers.inferred.filter((event) => visibleIds.has(event.id)),
    unset: tiers.unset.filter((event) => visibleIds.has(event.id)),
  };

  return {
    items,
    visibleTiers,
    fullTiers: tiers,
    events,
    all,
    filters: {
      confidence: requestedConfidence ? [...requestedConfidence] : null,
      min_magnitude: minMagnitude,
      limit,
      group_by: groupBy,
    },
  };
}

export function cmdReview(args: string[], ledgerPath: string) {
  const p = positional(args);
  const f = flags(args);
  if (p[0] === "batch") {
    const nestedArgs = args.filter((arg, index) => !(index === 0 && arg === "batch"));
    const outPath = f.out;
    const action = f.action ?? "confirm";
    if (!outPath) {
      console.error("Usage: clawbooks review batch [period] --out PATH --action confirm|reclassify [--confirmed-by NAME] [--notes TEXT] [--new-category CAT]");
      process.exit(1);
    }
    if (!["confirm", "reclassify"].includes(action)) {
      console.error("Invalid --action. Use confirm or reclassify.");
      process.exit(1);
    }
    const { items, filters } = visibleReviewItems(nestedArgs, ledgerPath);
    if (items.length === 0) {
      console.log(JSON.stringify({
        command: "review batch",
        status: "empty",
        action,
        out_path: outPath,
        item_count: 0,
        filters,
        next_steps: [
          "No matching review items were found for the requested filters.",
          "Relax the filters or run `clawbooks review` first to inspect the queue.",
        ],
      }, null, 2));
      return;
    }
    const lines = items.map((event) => {
      if (action === "confirm") {
        return JSON.stringify({
          source: "manual",
          type: "confirm",
          data: {
            original_id: event.id,
            confidence: "clear",
            confirmed_by: f["confirmed-by"] ?? "review-batch",
            notes: f.notes ?? "bulk review confirmation",
          },
        });
      }
      if (!f["new-category"]) {
        console.error("Bulk reclassify requires --new-category CAT.");
        process.exit(1);
      }
      return JSON.stringify({
        source: "manual",
        type: "reclassify",
        data: {
          original_id: event.id,
          new_category: f["new-category"],
        },
      });
    });
    try {
      writeFileSync(outPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to write review batch file: ${message}`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      command: "review batch",
      status: "ok",
      action,
      out_path: outPath,
      item_count: items.length,
      filters,
      next_steps: [
        "Inspect the generated JSONL before appending it.",
        `Append it with \`clawbooks batch < ${outPath}\` once you are satisfied.`,
      ],
    }, null, 2));
    return;
  }

  const { items, visibleTiers, fullTiers, events, all, filters } = visibleReviewItems(args, ledgerPath);
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
  const groups = filters.group_by && validGroupBy.has(filters.group_by)
    ? items.reduce((acc, event) => {
      const key = String(filters.group_by === "source" ? event.source : filters.group_by === "type" ? event.type : event.data.category ?? "uncategorized");
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
    filters,
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
    queue: queueSummary,
    groups,
    next_actions: nextActions,
    items,
  }, null, 2));
}
