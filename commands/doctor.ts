import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availablePolicyExamples, packageSupportFiles } from "../books.js";
import { classifyPolicyReadiness, lintPolicyText, policyText } from "../policy.js";

export function cmdDoctor(params: {
  booksDir: string | null;
  ledgerPath: string;
  policyPath: string;
  resolution: string;
}) {
  const support = packageSupportFiles();
  const booksExist = params.booksDir ? existsSync(params.booksDir) : false;
  const ledgerExists = existsSync(params.ledgerPath);
  const policyExists = existsSync(params.policyPath);
  const policy = policyText(params.policyPath);
  const policyReadiness = classifyPolicyReadiness(policy, params.policyPath);
  const lint = lintPolicyText(policy, params.policyPath);
  const canRead = ledgerExists;
  const canWrite = booksExist || params.booksDir !== null || params.resolution === "env:file" || params.resolution === "cwd:bare";

  console.log(JSON.stringify({
    command: "doctor",
    cwd: resolve("."),
    books: {
      books_dir: params.booksDir,
      ledger_path: params.ledgerPath,
      policy_path: params.policyPath,
      resolution: params.resolution,
      exists: {
        books_dir: booksExist,
        ledger: ledgerExists,
        policy: policyExists,
      },
    },
    package_support: {
      ...support,
      available_examples: availablePolicyExamples(),
    },
    status: {
      initialized: ledgerExists || policyExists,
      can_read_books: canRead,
      can_write_books: canWrite,
    },
    policy: {
      path: params.policyPath,
      exists: policyExists,
      readiness: policyReadiness.status,
      provisional_outputs: policyReadiness.provisional,
      reason: policyReadiness.reason,
      lint_status: lint.status,
      lint_issue_count: lint.issues.length,
      lint_suggestion_count: lint.suggestions.length,
      top_issues: lint.issues.slice(0, 3),
      top_suggestions: lint.suggestions.slice(0, 3),
    },
    next_steps: !ledgerExists && !policyExists ? [
      "Run `clawbooks init` in this folder, or pass `--books <dir>` to target an existing books directory.",
      "Read `program.md` before importing or reporting.",
      "Edit `policy.md` to match the entity, reporting basis, jurisdiction, and review rules.",
      "Have the agent inspect raw sources, normalize them into events, then run `clawbooks batch` or `clawbooks record`.",
      "After import, run `clawbooks verify`, `clawbooks reconcile`, `clawbooks summary`, and `clawbooks context` for the period.",
    ] : policyReadiness.provisional ? [
      "Read `program.md` and `clawbooks policy` before reporting. The current policy appears generic or incomplete.",
      "You may proceed, but treat outputs as provisional and say so explicitly in the answer.",
      "Flag material assumptions, uncertain classifications, and the minimum policy refinements needed.",
      "Run `clawbooks verify` and `clawbooks reconcile` after import or before producing a year-end answer.",
    ] : [
      "Run `clawbooks policy` or open the policy path shown above before reporting.",
      "Use `clawbooks context <period>` for agent reasoning and `clawbooks summary <period>` for precomputed aggregates.",
      "Use `clawbooks verify` and `clawbooks reconcile` after imports or before producing a year-end answer.",
    ],
    agent_bootstrap: {
      suggested_prompt: "Use clawbooks in this folder. Run `clawbooks doctor`, read `program.md` and `policy.md`, inspect the source files, import normalized events with provenance fields, then run `clawbooks verify`, `clawbooks summary`, and `clawbooks context` for the requested period before answering.",
      prompt_file: support.agent_bootstrap_path,
    },
  }, null, 2));
}
