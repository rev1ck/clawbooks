import { writeFileSync } from "node:fs";
import { readAll } from "../ledger.js";
import { flags, periodFromArgs, positional } from "../cli-helpers.js";
import { buildReviewBatch, buildReviewQueue } from "../operations.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

export function cmdReview(args: string[], ledgerPath: string) {
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  const p = positional(args);
  const parsed = parseReviewArgsWithPolicy(args, workflowPaths.policyPath);
  const all = readAll(ledgerPath);
  if (p[0] === "batch") {
    const nestedArgs = args.filter((arg, index) => !(index === 0 && arg === "batch"));
    const nested = parseReviewArgsWithPolicy(nestedArgs, workflowPaths.policyPath);
    if (!nested.outPath) {
      console.error("Usage: clawbooks review batch [period] --out PATH --action confirm|reclassify [--confirmed-by NAME] [--notes TEXT] [--new-category CAT]");
      process.exit(1);
    }
    try {
      const batch = buildReviewBatch({
        all,
        after: nested.after,
        before: nested.before,
        source: nested.source,
        confidence: nested.confidence,
        minMagnitude: nested.minMagnitude,
        limit: nested.limit,
        action: nested.action,
        outPath: nested.outPath,
        confirmedBy: nested.confirmedBy,
        notes: nested.notes,
        newCategory: nested.newCategory,
      });
      writeFileSync(nested.outPath, batch.lines.join("\n") + (batch.lines.length ? "\n" : ""), "utf-8");
      console.log(JSON.stringify({
        workflow,
        reporting_mode: workflow.reporting_mode,
        classification_basis: workflow.classification_basis,
        workflow_warning: workflow.warning,
        provisional_override: nested.allowProvisional,
        status_line: workflow.reporting_mode === "policy_grounded"
          ? "Status: POLICY_GROUNDED"
          : "Status: PROVISIONAL",
        ...batch.report,
      }, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Invalid --action") || message.startsWith("Bulk reclassify")) {
        console.error(message);
      } else {
        console.error(`Failed to write review batch file: ${message}`);
      }
      process.exit(1);
    }
    return;
  }

  const report = buildReviewQueue({
    all,
    after: parsed.after,
    before: parsed.before,
    source: parsed.source,
    confidence: parsed.confidence,
    minMagnitude: parsed.minMagnitude,
    limit: parsed.limit,
    groupBy: parsed.groupBy,
  });
  console.log(JSON.stringify({
    workflow,
    reporting_mode: workflow.reporting_mode,
    classification_basis: workflow.classification_basis,
    workflow_warning: workflow.warning,
    provisional_override: parsed.allowProvisional,
    status_line: workflow.reporting_mode === "policy_grounded"
      ? "Status: POLICY_GROUNDED"
      : "Status: PROVISIONAL",
    ...report,
  }, null, 2));
}

function parseReviewArgsWithPolicy(args: string[], policyPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args, { policyPath });
  return {
    after,
    before,
    source: f.source,
    confidence: f.confidence ? f.confidence.split(",").map((value) => value.trim()).filter(Boolean) : null,
    minMagnitude: f["min-magnitude"] !== undefined ? Number(f["min-magnitude"]) : null,
    limit: f.limit !== undefined ? parseInt(f.limit) : null,
    groupBy: f["group-by"] ?? null,
    outPath: f.out,
    action: f.action ?? "confirm",
    confirmedBy: f["confirmed-by"],
    notes: f.notes,
    newCategory: f["new-category"],
    allowProvisional: f["allow-provisional"] === "true",
  };
}
