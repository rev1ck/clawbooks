import { readAll, rewrite } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildCompactPlan } from "../operations.js";

export function cmdCompact(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { before } = periodFromArgs(args);

  if (!before) {
    console.error("Usage: clawbooks compact <period> or --before <date>");
    console.error("  Moves events before the cutoff to an archive file and saves a snapshot.");
    console.error("  Example: clawbooks compact 2025-12");
    process.exit(1);
  }

  const plan = buildCompactPlan({ all: readAll(ledgerPath), before });

  const archivePath = f.archive ?? ledgerPath.replace(".jsonl", `-archive-${before.slice(0, 10)}.jsonl`);
  if (!plan.compacted) {
    console.log(JSON.stringify({ compacted: false, reason: plan.reason }));
    return;
  }

  rewrite(archivePath, plan.archive);
  rewrite(ledgerPath, [plan.snapshot_event, ...plan.keep]);

  console.log(JSON.stringify({
    compacted: true,
    archived: plan.archive.length,
    archive_path: archivePath,
    snapshot_id: plan.snapshot_event.id,
    remaining: plan.keep.length + 1,
  }, null, 2));
}
