import { readAll } from "../ledger.js";
import { periodFromArgs, flags } from "../cli-helpers.js";
import { buildDocumentReport } from "../operations.js";

export function cmdDocuments(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const report = buildDocumentReport({
    all: readAll(ledgerPath),
    after,
    before,
    source: f.source,
    asOf: f["as-of"] ?? new Date().toISOString(),
    status: f.status,
    direction: f.direction,
  });
  console.log(JSON.stringify(report, null, 2));
}
