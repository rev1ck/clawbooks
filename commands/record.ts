import { append, computeId, type LedgerEvent } from "../ledger.js";
import { flags, positional } from "../cli-helpers.js";
import { enforceSign } from "../event-types.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

export function cmdRecord(args: string[], ledgerPath: string) {
  const workflowPaths = inferWorkflowPaths(ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: workflowPaths.policyPath });
  const f = flags(args);
  const allowProvisional = f["allow-provisional"] === "true";
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
  const classificationBasis = f["classification-basis"]
    ?? (workflow.reporting_readiness === "ready" ? "policy_guided" : "manual_operator");
  const reportingMode = workflow.reporting_readiness === "ready" && classificationBasis.startsWith("policy_")
    ? "policy_grounded"
    : "provisional";

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
      console.log(JSON.stringify({
        recorded: true,
        id: event.id,
        workflow,
        reporting_mode: reportingMode,
        classification_basis: classificationBasis,
        workflow_warning: workflow.warning,
        provisional_override: allowProvisional,
        status_line: reportingMode === "policy_grounded"
          ? "Status: POLICY_GROUNDED"
          : "Status: PROVISIONAL",
      }));
    } else {
      console.log(JSON.stringify({
        recorded: false,
        reason: "duplicate",
        id: event.id,
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
  } catch (err) {
    console.error(String((err as Error).message));
    process.exit(1);
  }
}
