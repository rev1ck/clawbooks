import { readAll } from "../ledger.js";
import { buildStats } from "../operations.js";

export function cmdStats(ledgerPath: string) {
  const stats = buildStats(readAll(ledgerPath));
  if (!stats) {
    console.log("Empty ledger.");
    return;
  }
  console.log(JSON.stringify(stats, null, 2));
}
