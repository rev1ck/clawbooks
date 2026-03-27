import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { updateImportSessionRecord } from "../import-sessions.js";
import { VALID_CLASSIFICATION_BASES, buildWorkflowStatus, deriveReportingMode, inferWorkflowPaths } from "../workflow-state.js";
import { flags } from "../cli-helpers.js";
import { prepareBatch } from "../operations.js";

export function cmdBatch(args: string[], input: string, params: { ledgerPath: string; booksDir?: string | null; policyPath?: string }) {
  const f = flags(args);
  const dryRun = f["dry-run"] === "true";
  const workflowPaths = inferWorkflowPaths(params.ledgerPath);
  const booksDir = params.booksDir ?? workflowPaths.booksDir;
  const policyPath = params.policyPath ?? workflowPaths.policyPath;
  const workflow = buildWorkflowStatus({ booksDir, policyPath });
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

  if (!existsSync(params.ledgerPath)) writeFileSync(params.ledgerPath, "", "utf-8");
  const existingLines = readFileSync(params.ledgerPath, "utf-8").split("\n").filter(Boolean);
  const result = prepareBatch({ input, existingLines });

  if (!dryRun && result.newLines.length > 0) {
    appendFileSync(params.ledgerPath, result.newLines.join("\n") + "\n", "utf-8");
  }

  if (typeof f["import-session"] === "string" && f["import-session"].trim()) {
    const lifecycle = dryRun
      ? (result.newLines.length === 0 ? "skipped_duplicate" : "checked")
      : (result.newLines.length > 0 ? "appended" : "skipped_duplicate");
    updateImportSessionRecord(booksDir, params.ledgerPath, f["import-session"], {
      lifecycle,
      appended_event_count: dryRun ? 0 : result.newLines.length,
      ledger_changed: !dryRun && result.newLines.length > 0,
    });
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
    dry_run: dryRun,
    would_append: result.newLines.length,
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
