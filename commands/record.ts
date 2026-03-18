import { append, computeId, type LedgerEvent } from "../ledger.js";
import { positional } from "../cli-helpers.js";
import { enforceSign } from "../event-types.js";

export function cmdRecord(args: string[], ledgerPath: string) {
  const json = positional(args)[0];
  if (!json) {
    console.error("Usage: clawbooks record '<json>'");
    console.error(`  clawbooks record '{"source":"bank","type":"expense","data":{"amount":100,"currency":"USD","description":"test"}}'`);
    process.exit(1);
  }

  let parsed: { source: string; type: string; data: Record<string, unknown>; ts?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error("Invalid JSON.");
    process.exit(1);
  }

  if (!parsed.source || !parsed.type || !parsed.data) {
    console.error("Required fields: source, type, data");
    process.exit(1);
  }

  enforceSign(parsed.type, parsed.data);

  const ts = parsed.ts ?? new Date().toISOString();
  const event: LedgerEvent = {
    ts,
    source: parsed.source,
    type: parsed.type,
    data: parsed.data,
    id: computeId(parsed.data, { source: parsed.source, type: parsed.type, ts }),
    prev: "",
  };

  try {
    if (append(ledgerPath, event)) {
      console.log(JSON.stringify({ recorded: true, id: event.id }));
    } else {
      console.log(JSON.stringify({ recorded: false, reason: "duplicate", id: event.id }));
    }
  } catch (err) {
    console.error(String((err as Error).message));
    process.exit(1);
  }
}
