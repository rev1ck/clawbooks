import { readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { type DateBasis } from "../imports.js";
import { buildReconciliation } from "../operations.js";

export function cmdReconcile(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const dateBasis = (f["date-basis"] ?? "ledger") as DateBasis;

  try {
    const report = buildReconciliation({
      all: readAll(ledgerPath),
      after,
      before,
      source: f.source,
      dateBasis,
      currency: f.currency,
      count: f.count !== undefined ? parseInt(f.count) : undefined,
      debits: f.debits !== undefined ? parseFloat(f.debits) : undefined,
      credits: f.credits !== undefined ? parseFloat(f.credits) : undefined,
      openingBalance: f["opening-balance"] !== undefined ? parseFloat(f["opening-balance"]) : undefined,
      closingBalance: f["closing-balance"] !== undefined ? parseFloat(f["closing-balance"]) : undefined,
      gaps: f.gaps === "true",
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(String((err as Error).message));
    process.exit(1);
  }
}
