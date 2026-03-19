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
  const hasSupportFiles = support.exists.program && support.exists.agent_bootstrap && support.exists.event_schema;

  console.log(JSON.stringify({
    command: "doctor",
    cwd: resolve("."),
    resolved_books: {
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
      support_files_present: hasSupportFiles,
    },
    diagnostics: {
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
      support_files: {
        program: support.exists.program ? "ok" : "missing",
        agent_bootstrap: support.exists.agent_bootstrap ? "ok" : "missing",
        event_schema: support.exists.event_schema ? "ok" : "missing",
      },
    },
    suggested_next_command: "clawbooks quickstart",
    notes: [
      "Use `clawbooks quickstart` for workflow guidance, core file roles, and reporting capabilities.",
      !ledgerExists && !policyExists
        ? "No books were found yet. Run `clawbooks init` or point clawbooks at an existing books directory."
        : "Books were resolved successfully. Review the policy diagnostics above before relying on outputs.",
    ],
    agent_bootstrap: {
      prompt_file: support.agent_bootstrap_path,
    },
  }, null, 2));
}
