import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { computeId, hashLine, type LedgerEvent } from "../ledger.js";
import { META_TYPES, enforceSign } from "../event-types.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

export function cmdBatch(input: string, ledgerPath: string) {
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  if (!input.trim()) {
    console.error("Pipe JSONL to stdin. Each line: {source, type, data, ts?}");
    console.error("  cat events.jsonl | clawbooks batch");
    process.exit(1);
  }

  let recorded = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  if (!existsSync(ledgerPath)) writeFileSync(ledgerPath, "", "utf-8");
  const existingLines = readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean);
  const existingIds = new Set(existingLines.map((l) => (JSON.parse(l) as LedgerEvent).id));
  let prevHash = existingLines.length > 0 ? hashLine(existingLines[existingLines.length - 1]) : "genesis";
  const newLines: string[] = [];

  for (const line of input.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const source = parsed.source ?? "import";
      const type = parsed.type ?? "unknown";
      const data = parsed.data ?? parsed;

      enforceSign(type, data);

      const ts = parsed.ts ?? new Date().toISOString();
      const event: LedgerEvent = {
        ts,
        source,
        type,
        data,
        id: computeId(data, { source, type, ts }),
        prev: "",
      };

      if (existingIds.has(event.id)) {
        skipped++;
        continue;
      }

      if (!META_TYPES.has(event.type) && event.data.currency === undefined) {
        throw new Error(`Event missing data.currency (type: ${event.type}, id: ${event.id})`);
      }

      event.prev = prevHash;
      const jsonLine = JSON.stringify(event);
      prevHash = hashLine(jsonLine);
      newLines.push(jsonLine);
      existingIds.add(event.id);
      recorded++;
    } catch (err) {
      errors++;
      errorMessages.push(String((err as Error).message));
    }
  }

  if (newLines.length > 0) {
    appendFileSync(ledgerPath, newLines.join("\n") + "\n", "utf-8");
  }

  if (errorMessages.length > 0) {
    console.error(errorMessages.join("\n"));
  }

  console.log(JSON.stringify({ recorded, skipped, errors, workflow }));
}
