import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { VALID_CLASSIFICATION_BASES, buildWorkflowStatus, deriveReportingMode, inferWorkflowPaths } from "../workflow-state.js";
import { flags } from "../cli-helpers.js";
import { prepareBatch } from "../operations.js";

export function cmdBatch(args: string[], input: string, ledgerPath: string) {
  const f = flags(args);
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  const allowProvisional = f["allow-provisional"] === "true";
  const classificationBasis = f["classification-basis"]
    ?? (workflow.reporting_readiness === "ready" ? "policy_guided" : "manual_operator");
  if (!VALID_CLASSIFICATION_BASES.has(classificationBasis)) {
    console.error("Invalid --classification-basis. Use policy_explicit, policy_guided, heuristic_pattern, manual_operator, mixed, or unknown.");
    process.exit(1);
  }
  const reportingMode = deriveReportingMode(workflow.reporting_readiness, classificationBasis);
  if (!input.trim()) {
    console.error("Pipe JSONL to stdin. Each line: {source, type, data, ts?}");
    console.error("  cat events.jsonl | clawbooks batch");
    process.exit(1);
  }

  if (!existsSync(ledgerPath)) writeFileSync(ledgerPath, "", "utf-8");
  const existingLines = readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean);
  const result = prepareBatch({ input, existingLines });

  if (result.newLines.length > 0) {
    appendFileSync(ledgerPath, result.newLines.join("\n") + "\n", "utf-8");
  }

  if (result.warnings.length > 0) {
    console.error(result.warnings.join("\n"));
  }

  if (result.errorMessages.length > 0) {
    console.error(result.errorMessages.join("\n"));
  }

  console.log(JSON.stringify({
    recorded: result.recorded,
    skipped: result.skipped,
    errors: result.errors,
    workflow,
    reporting_mode: reportingMode,
    classification_basis: classificationBasis,
    workflow_warning: workflow.warning,
    provisional_override: allowProvisional,
    status_line: reportingMode === "policy_grounded"
      ? "Status: POLICY_GROUNDED"
      : "Status: PROVISIONAL",
  }));
}
