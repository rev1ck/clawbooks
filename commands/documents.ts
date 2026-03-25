import { readAll } from "../ledger.js";
import { periodFromArgs, flags, positional } from "../cli-helpers.js";
import { buildDocumentCounterpartyReport, buildDocumentReport } from "../operations.js";
import { inferWorkflowPaths } from "../workflow-state.js";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function printCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    console.log("");
    return;
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  console.log(headers.join(","));
  for (const row of rows) {
    console.log(headers.map((header) => JSON.stringify(csvCell(row[header]))).join(","));
  }
}

export function cmdDocuments(args: string[], ledgerPath: string) {
  const policyPath = inferWorkflowPaths(ledgerPath).policyPath;
  const f = flags(args);
  const p = positional(args);
  const all = readAll(ledgerPath);

  if (p[0] === "counterparties") {
    const { after, before } = periodFromArgs(args.slice(1), { policyPath });
    const report = buildDocumentCounterpartyReport({
      all,
      after,
      before,
      source: f.source,
      asOf: f["as-of"] ?? new Date().toISOString(),
      status: f.status,
      direction: f.direction,
      match: f.match ?? f.counterparty,
    });
    if (f.format === "csv") {
      printCsv(report.counterparties);
      return;
    }
    console.log(JSON.stringify({
      command: "documents counterparties",
      ...report,
    }, null, 2));
    return;
  }

  const { after, before } = periodFromArgs(args, { policyPath });
  const report = buildDocumentReport({
    all,
    after,
    before,
    source: f.source,
    asOf: f["as-of"] ?? new Date().toISOString(),
    status: f.status,
    direction: f.direction,
    counterparty: f.counterparty,
    groupBy: f["group-by"],
  });
  if (f.format === "csv") {
    printCsv(report.grouped ?? report.items);
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}
