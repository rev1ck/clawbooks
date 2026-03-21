import { flags, positional } from "../cli-helpers.js";
import { buildWorkflowStatus, fileSha256, readWorkflowState, resolveWorkflowStatePath, writeWorkflowState } from "../workflow-state.js";
import { resolveProgramPath } from "../books.js";

export function cmdWorkflow(args: string[], params: {
  booksDir: string | null;
  policyPath: string;
}) {
  const p = positional(args);
  const f = flags(args);
  const subcommand = p[0] ?? "status";

  if (subcommand === "ack") {
    const program = resolveProgramPath(params.booksDir);
    const statePath = resolveWorkflowStatePath(params.booksDir, params.policyPath);
    const existing = readWorkflowState(statePath);
    const now = new Date().toISOString();

    const nextCurrent = {
      program: f.program === "true" || (!f.program && !f.policy) ? {
        path: program.path,
        sha256: fileSha256(program.path)!,
        acknowledged_at: now,
      } : existing?.current?.program ?? null,
      policy: f.policy === "true" || (!f.program && !f.policy) ? {
        path: params.policyPath,
        sha256: fileSha256(params.policyPath)!,
        acknowledged_at: now,
      } : existing?.current?.policy ?? null,
      agent: f.agent ?? null,
      operator: f.operator ?? null,
      classification_basis: "policy_intended",
      source_docs: f["source-docs"] ? f["source-docs"].split(",").map((value) => value.trim()).filter(Boolean) : [],
    };

    writeWorkflowState(statePath, {
      current: nextCurrent,
      history: existing?.current ? [existing.current, ...(existing.history ?? [])].slice(0, 20) : (existing?.history ?? []),
    });

    const status = buildWorkflowStatus(params);
    console.log(JSON.stringify({
      command: "workflow ack",
      books: params.booksDir,
      acknowledged_at: now,
      workflow: status,
      next_best_command: "clawbooks doctor",
    }, null, 2));
    return;
  }

  if (subcommand === "status") {
    console.log(JSON.stringify({
      command: "workflow status",
      books: params.booksDir,
      workflow: buildWorkflowStatus(params),
      next_best_command: buildWorkflowStatus(params).reporting_readiness === "ready"
        ? "clawbooks summary"
        : "clawbooks workflow ack --program --policy",
    }, null, 2));
    return;
  }

  console.error("Usage: clawbooks workflow [status|ack] [--program] [--policy] [--agent NAME] [--operator NAME] [--source-docs a,b,c]");
  process.exit(1);
}
