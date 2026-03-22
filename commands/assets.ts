import { readAll } from "../ledger.js";
import { flags } from "../cli-helpers.js";
import { buildAssetReport } from "../operations.js";

export function cmdAssets(args: string[], ledgerPath: string) {
  const f = flags(args);
  const report = buildAssetReport({
    all: readAll(ledgerPath),
    category: f.category,
    defaultLife: parseInt(f.life ?? "36"),
    asOf: f["as-of"] ?? new Date().toISOString(),
  });
  console.log(JSON.stringify(report, null, 2));
}
