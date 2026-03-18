import { filter, readAll } from "../ledger.js";
import { flags } from "../cli-helpers.js";

export function cmdLog(args: string[], ledgerPath: string) {
  const f = flags(args);
  const all = readAll(ledgerPath);
  const events = filter(all, {
    source: f.source,
    type: f.type,
    after: f.after,
    before: f.before,
    last: f.last ? parseInt(f.last) : 20,
  });

  for (const e of events) console.log(JSON.stringify(e));
}
