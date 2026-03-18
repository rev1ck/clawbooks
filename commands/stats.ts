import { readAll } from "../ledger.js";
import { sortByTimestamp } from "../reporting.js";

export function cmdStats(ledgerPath: string) {
  const all = readAll(ledgerPath);
  if (all.length === 0) {
    console.log("Empty ledger.");
    return;
  }

  const sources = new Set(all.map((e) => e.source));
  const types = new Set(all.map((e) => e.type));
  const chronological = sortByTimestamp(all);
  const first = chronological[0].ts;
  const last = chronological[chronological.length - 1].ts;
  const snapshots = all.filter((e) => e.type === "snapshot").length;

  console.log(JSON.stringify({
    events: all.length,
    snapshots,
    sources: [...sources],
    types: [...types],
    first,
    last,
  }, null, 2));
}
