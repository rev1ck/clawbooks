import { append, computeId, readAll, type LedgerEvent } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildSnapshotData } from "../operations.js";

export function cmdSnapshot(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const snapshotData = buildSnapshotData({ all: readAll(ledgerPath), after, before });

  if (f.save === "true") {
    const ts = new Date().toISOString();
    const event: LedgerEvent = {
      ts,
      source: "clawbooks:snapshot",
      type: "snapshot",
      data: snapshotData,
      id: computeId(snapshotData as unknown as Record<string, unknown>, {
        source: "clawbooks:snapshot",
        type: "snapshot",
        ts,
      }),
      prev: "",
    };

    if (append(ledgerPath, event)) {
      console.log(JSON.stringify({ saved: true, id: event.id, snapshot: snapshotData }, null, 2));
    } else {
      console.log(JSON.stringify({ saved: false, reason: "duplicate", snapshot: snapshotData }, null, 2));
    }
  } else {
    console.log(JSON.stringify(snapshotData, null, 2));
  }
}
