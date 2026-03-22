import { readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildSummary } from "../operations.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

export function cmdSummary(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const allowProvisional = f["allow-provisional"] === "true";
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  const summary = buildSummary({
    all: readAll(ledgerPath),
    after,
    before,
    source: f.source,
  });

  console.log(JSON.stringify({
    workflow,
    reporting_mode: workflow.reporting_mode,
    classification_basis: workflow.classification_basis,
    workflow_warning: workflow.warning,
    provisional_override: allowProvisional,
    status_line: workflow.reporting_mode === "policy_grounded"
      ? "Status: POLICY_GROUNDED"
      : "Status: PROVISIONAL",
    ...summary,
  }, null, 2));
}
