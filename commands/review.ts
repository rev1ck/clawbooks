import { filter, readAll, type LedgerEvent } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildConfirmedSet } from "../review.js";
import { META_TYPES } from "../event-types.js";
import { sortByTimestamp } from "../reporting.js";

export function cmdReview(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(ledgerPath);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

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
