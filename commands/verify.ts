import { readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { analyzeVerification } from "../operations.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

export function cmdVerify(args: string[], ledgerPath: string) {
  const f = flags(args);
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const { after, before } = periodFromArgs(args, { policyPath: workflowPaths.policyPath });
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  const all = readAll(ledgerPath);
  const report = analyzeVerification(all, {
    source: f.source,
    after,
    before,
    balance: f.balance !== undefined ? parseFloat(f.balance) : undefined,
    openingBalance: f["opening-balance"] !== undefined ? parseFloat(f["opening-balance"]) : undefined,
    currency: f.currency,
    diagnose: f.diagnose === "true",
  });

  console.log(JSON.stringify({
    workflow,
    requested_scope: {
      after: after ?? null,
      before: before ?? null,
      source: f.source ?? null,
      currency: f.currency ?? null,
    },
    resolved_scope: {
      after: after ?? null,
      before: before ?? null,
      source: f.source ?? null,
      currency: f.currency ?? null,
      event_count: report.event_count,
    },
    workflow_state: report.event_count === 0 ? "empty_scope" : "checked",
    what_matters: report.event_count === 0
      ? "No events matched the resolved scope. Double-check the period, source, or books path."
      : "Integrity and balance checks ran against the resolved scope above.",
    next_best_command: report.event_count === 0
      ? "clawbooks where"
      : "clawbooks summary",
    ...report,
  }, null, 2));
}
