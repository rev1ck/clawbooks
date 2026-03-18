import { computeId, readAll, rewrite, type LedgerEvent } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { META_TYPES } from "../event-types.js";
import { buildReportingSections, round2, sortByTimestamp } from "../reporting.js";

export function cmdCompact(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { before } = periodFromArgs(args);

  if (!before) {
    console.error("Usage: clawbooks compact <period> or --before <date>");
    console.error("  Moves events before the cutoff to an archive file and saves a snapshot.");
    console.error("  Example: clawbooks compact 2025-12");
    process.exit(1);
  }

  const all = readAll(ledgerPath);
  const keep = sortByTimestamp(all.filter((e) => e.ts > before));
  const archive = sortByTimestamp(all.filter((e) => e.ts <= before));

  if (archive.length === 0) {
    console.log(JSON.stringify({ compacted: false, reason: "no events before cutoff" }));
    return;
  }

  const balances: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let eventCount = 0;
  const reporting = buildReportingSections(archive);

  for (const e of archive) {
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
    period: { after: "all", before },
    event_count: eventCount,
    balances,
    by_category: byCategory,
    movement_summary: reporting.movement_summary,
    report_sections: reporting.sections,
    report_totals: reporting.totals,
    compacted_from: archive.length,
  };

  const ts = before;
  const snapshotEvent: LedgerEvent = {
    ts,
    source: "clawbooks:compact",
    type: "snapshot",
    data: snapshotData,
    id: computeId(snapshotData as unknown as Record<string, unknown>, {
      source: "clawbooks:compact",
      type: "snapshot",
      ts,
    }),
    prev: "",
  };

  const archivePath = f.archive ?? ledgerPath.replace(".jsonl", `-archive-${before.slice(0, 10)}.jsonl`);
  rewrite(archivePath, archive);
  rewrite(ledgerPath, [snapshotEvent, ...keep]);

  console.log(JSON.stringify({
    compacted: true,
    archived: archive.length,
    archive_path: archivePath,
    snapshot_id: snapshotEvent.id,
    remaining: keep.length + 1,
  }, null, 2));
}
