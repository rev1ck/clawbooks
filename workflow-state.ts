import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { resolveProgramPath } from "./books.js";

export type WorkflowAckFile = {
  current: {
    program: {
      path: string;
      sha256: string;
      acknowledged_at: string;
    } | null;
    policy: {
      path: string;
      sha256: string;
      acknowledged_at: string;
    } | null;
    agent: string | null;
    operator: string | null;
    classification_basis: string;
    source_docs: string[];
  } | null;
  history: Array<WorkflowAckFile["current"]>;
};

export function inferWorkflowPaths(ledgerPath: string): {
  booksDir: string | null;
  policyPath: string;
  workflowStatePath: string;
} {
  const ledgerDir = resolve(dirname(ledgerPath));
  const booksDir = basename(ledgerDir) === ".books" ? ledgerDir : null;
  const policyPath = join(ledgerDir, "policy.md");
  const workflowStatePath = join(ledgerDir, "workflow-state.json");
  return { booksDir, policyPath, workflowStatePath };
}

export function resolveWorkflowStatePath(booksDir: string | null, policyPath: string): string {
  return booksDir ? join(booksDir, "workflow-state.json") : join(dirname(resolve(policyPath)), "workflow-state.json");
}

export function fileSha256(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readWorkflowState(path: string): WorkflowAckFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as WorkflowAckFile;
  } catch {
    return null;
  }
}

export function writeWorkflowState(path: string, state: WorkflowAckFile): void {
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function buildWorkflowStatus(params: {
  booksDir: string | null;
  policyPath: string;
}) {
  const program = resolveProgramPath(params.booksDir);
  const workflowStatePath = resolveWorkflowStatePath(params.booksDir, params.policyPath);
  const stored = readWorkflowState(workflowStatePath);
  const current = stored?.current ?? null;
  const programHash = fileSha256(program.path);
  const policyHash = fileSha256(params.policyPath);
  const programAcknowledged = Boolean(current?.program?.sha256 && current.program.sha256 === programHash);
  const policyAcknowledged = Boolean(current?.policy?.sha256 && current.policy.sha256 === policyHash);
  const programAckStale = Boolean(current?.program && current.program.sha256 !== programHash);
  const policyAckStale = Boolean(current?.policy && current.policy.sha256 !== policyHash);

  let reportingReadiness: "blocked" | "caution" | "ready" = "ready";
  if (!program.exists || !existsSync(params.policyPath)) {
    reportingReadiness = "blocked";
  } else if (!programAcknowledged || !policyAcknowledged || programAckStale || policyAckStale) {
    reportingReadiness = "caution";
  }

  const classificationBasis = reportingReadiness === "ready"
    ? (current?.classification_basis ?? "policy_intended")
    : "unknown_or_heuristic";

  const warning = reportingReadiness === "ready"
    ? null
    : !program.exists || !existsSync(params.policyPath)
      ? "program.md or policy.md is missing, so reporting is blocked."
      : "program.md and policy.md may not have been reviewed for the current run. Results may be heuristic rather than policy-grounded.";

  return {
    state_path: workflowStatePath,
    program: {
      path: program.path,
      source: program.source,
      exists: program.exists,
      sha256: programHash,
      acknowledged: programAcknowledged,
      ack_stale: programAckStale,
      acknowledged_at: current?.program?.acknowledged_at ?? null,
    },
    policy: {
      path: params.policyPath,
      exists: existsSync(params.policyPath),
      sha256: policyHash,
      acknowledged: policyAcknowledged,
      ack_stale: policyAckStale,
      acknowledged_at: current?.policy?.acknowledged_at ?? null,
    },
    acknowledged: {
      agent: current?.agent ?? null,
      operator: current?.operator ?? null,
      source_docs: current?.source_docs ?? [],
    },
    workflow_state:
      reportingReadiness === "ready"
        ? "policy_acknowledged"
        : reportingReadiness === "blocked"
          ? "policy_blocked"
          : "policy_unacknowledged",
    reporting_readiness: reportingReadiness,
    classification_basis: classificationBasis,
    warning,
  };
}
