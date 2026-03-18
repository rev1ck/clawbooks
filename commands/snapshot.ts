import { append, computeId, filter, readAll, type LedgerEvent } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { META_TYPES } from "../event-types.js";
import { buildReportingSections, round2, sortByTimestamp } from "../reporting.js";

export function cmdSnapshot(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(ledgerPath);
  const events = sortByTimestamp(filter(all, { after, before }));

  const balances: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let eventCount = 0;
  const reporting = buildReportingSections(events);

  for (const e of events) {
    if (META_TYPES.has(e.type)) continue;

    const amount = Number(e.data.amount);
    if (isNaN(amount)) continue;

    eventCount++;
    const currency = String(e.data.currency ?? "UNKNOWN");
    const category = String(e.data.category ?? e.type);

    balances[currency] = round2((balances[currency] ?? 0) + amount);
    byCategory[category] = round2((byCategory[category] ?? 0) + amount);
  }

  const snapshotData = {
    period: { after: after ?? "all", before: before ?? "now" },
    event_count: eventCount,
    balances,
    by_category: byCategory,
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
  };

  if (f.save === "true") {
    const ts = new Date().toISOString();
    const event: LedgerEvent = {
      ts,
      source: "clawbooks:snapshot",
      type: "snapshot",
      data: snapshotData,
      id: computeId(snapshotData as unknown as Record<string, unknown>, {
        source: "clawbooks:snapshot",
        type: "snapshot",
        ts,
      }),
      prev: "",
    };

    if (append(ledgerPath, event)) {
      console.log(JSON.stringify({ saved: true, id: event.id, snapshot: snapshotData }, null, 2));
    } else {
      console.log(JSON.stringify({ saved: false, reason: "duplicate", snapshot: snapshotData }, null, 2));
    }
  } else {
    console.log(JSON.stringify(snapshotData, null, 2));
  }
}
