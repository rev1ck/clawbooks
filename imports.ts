import type { LedgerEvent } from "./ledger.js";
import { normalizeDateBoundary } from "./cli-helpers.js";

export type DateBasis = "ledger" | "transaction" | "posting";

export function eventDateForBasis(event: LedgerEvent, basis: DateBasis): string | null {
  if (basis === "ledger") return event.ts;

  const raw = basis === "transaction"
    ? event.data.transaction_date
    : event.data.posting_date;

  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeDateBoundary(raw.trim(), "after");
}

export function filterByDateBasis(
  events: LedgerEvent[],
  opts: { after?: string; before?: string; basis: DateBasis },
): { events: LedgerEvent[]; missingBasisIds: string[] } {
  if (opts.basis === "ledger") {
    return {
      events: events.filter((event) => (!opts.after || event.ts >= opts.after) && (!opts.before || event.ts <= opts.before)),
      missingBasisIds: [],
    };
  }

  const filtered: LedgerEvent[] = [];
  const missingBasisIds: string[] = [];

  for (const event of events) {
    const dateValue = eventDateForBasis(event, opts.basis);
    if (!dateValue) {
      missingBasisIds.push(event.id);
      continue;
    }
    if (opts.after && dateValue < opts.after) continue;
    if (opts.before && dateValue > opts.before) continue;
    filtered.push(event);
  }

  return { events: filtered, missingBasisIds };
}
