import { readAll, filter } from "../ledger.js";
import { periodFromArgs, flags } from "../cli-helpers.js";
import { sortByTimestamp } from "../reporting.js";
import { buildDocumentSettlementData } from "../documents.js";

export function cmdDocuments(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(ledgerPath);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));
  const data = buildDocumentSettlementData(events, f["as-of"] ?? new Date().toISOString());

  let items = data.items;
  if (f.status) items = items.filter((item) => item.status === f.status);
  if (f.direction) items = items.filter((item) => item.direction === f.direction);

  console.log(JSON.stringify({
    as_of: f["as-of"] ?? new Date().toISOString(),
    settlement_summary: data.settlement_summary,
    documents_by_direction: data.documents_by_direction,
    receivable_candidates: data.receivable_candidates,
    payable_candidates: data.payable_candidates,
    documents_missing_invoice_id: data.documents_missing_invoice_id,
    unmatched_cash: data.unmatched_cash,
    items,
  }, null, 2));
}
