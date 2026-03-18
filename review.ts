import type { LedgerEvent } from "./ledger.js";
import { META_TYPES } from "./event-types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildReclassifyMap(events: LedgerEvent[]): Record<string, string> {
  const reclassifyMap: Record<string, string> = {};
  for (const e of events) {
    if (e.type === "reclassify" && e.data.original_id && e.data.new_category) {
      reclassifyMap[String(e.data.original_id)] = String(e.data.new_category);
    }
  }
  return reclassifyMap;
}

export function buildConfirmedSet(events: LedgerEvent[]): Set<string> {
  return new Set(
    events
      .filter((e) => e.type === "confirm" && e.data.original_id)
      .map((e) => String(e.data.original_id)),
  );
}

export function buildCorrectionSummary(events: LedgerEvent[]) {
  const corrections = events.filter((e) => e.type === "correction");
  const confirms = events.filter((e) => e.type === "confirm");
  const correctedOriginals = new Set(
    corrections
      .filter((e) => e.data.original_id)
      .map((e) => String(e.data.original_id)),
  );
  const confirmedOriginals = new Set(
    confirms
      .filter((e) => e.data.original_id)
      .map((e) => String(e.data.original_id)),
  );
  return {
    correction_events: corrections.length,
    corrected_events: correctedOriginals.size,
    confirm_events: confirms.length,
    confirmed_events: confirmedOriginals.size,
    recent_corrections: corrections.slice(-5).map((e) => ({
      id: e.id,
      ts: e.ts,
      original_id: String(e.data.original_id ?? ""),
      reason: String(e.data.reason ?? ""),
      corrected_fields: e.data.corrected_fields ?? null,
    })),
    recent_confirmations: confirms.slice(-5).map((e) => ({
      id: e.id,
      ts: e.ts,
      original_id: String(e.data.original_id ?? ""),
      confidence: String(e.data.confidence ?? ""),
      confirmed_by: String(e.data.confirmed_by ?? e.data.recorded_by ?? ""),
    })),
  };
}

export function reviewCounts(events: LedgerEvent[], all: LedgerEvent[]): Record<string, number> {
  const reclassified = new Set(
    all.filter((e) => e.type === "reclassify").map((e) => String(e.data.original_id)),
  );
  const confirmed = buildConfirmedSet(all);
  const counts = { unclear: 0, inferred: 0, unset: 0, clear: 0 };

  for (const e of events) {
    if (e.type === "reclassify" || META_TYPES.has(e.type) || reclassified.has(e.id) || confirmed.has(e.id)) continue;
    const confidence = String(e.data.confidence ?? "unset");
    if (confidence === "clear") counts.clear++;
    else if (confidence === "unclear") counts.unclear++;
    else if (confidence === "inferred") counts.inferred++;
    else counts.unset++;
  }

  return counts;
}

export function unresolvedReviewItems(events: LedgerEvent[], all: LedgerEvent[]): Array<{
  id: string;
  ts: string;
  source: string;
  type: string;
  category: string;
  confidence: string;
  amount: number;
  magnitude: number;
}> {
  const reclassified = new Set(
    all.filter((e) => e.type === "reclassify").map((e) => String(e.data.original_id)),
  );
  const confirmed = buildConfirmedSet(all);

  return events
    .filter((e) => !META_TYPES.has(e.type) && !reclassified.has(e.id) && !confirmed.has(e.id))
    .map((e) => {
      const amount = Number(e.data.amount);
      return {
        id: e.id,
        ts: e.ts,
        source: e.source,
        type: e.type,
        category: String(e.data.category ?? e.type),
        confidence: String(e.data.confidence ?? "unset"),
        amount: isNaN(amount) ? 0 : amount,
        magnitude: isNaN(amount) ? 0 : Math.abs(amount),
      };
    })
    .filter((e) => e.confidence !== "clear");
}

export function buildReviewMateriality(events: LedgerEvent[], all: LedgerEvent[]) {
  const totals: Record<string, { count: number; magnitude: number }> = {
    unclear: { count: 0, magnitude: 0 },
    inferred: { count: 0, magnitude: 0 },
    unset: { count: 0, magnitude: 0 },
  };
  const items = unresolvedReviewItems(events, all);

  for (const item of items) {
    if (!totals[item.confidence]) continue;
    totals[item.confidence].count++;
    totals[item.confidence].magnitude = round2(totals[item.confidence].magnitude + item.magnitude);
  }

  return {
    by_confidence: totals,
    top_items: items
      .sort((a, b) => b.magnitude - a.magnitude || a.id.localeCompare(b.id))
      .slice(0, 5),
  };
}
