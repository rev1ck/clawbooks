import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availablePolicyExamples, packageSupportFiles } from "../books.js";
import { classifyPolicyReadiness, lintPolicyText, policyText } from "../policy.js";

export function cmdQuickstart(params: {
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

  console.log(JSON.stringify({
    command: "quickstart",
    cwd: resolve("."),
    what_clawbooks_is: {
      summary: "Financial memory for agents: a ledger of facts, a policy for interpretation, and a program for operating the workflow.",
      mental_model: [
        "Read program.md to learn how clawbooks works.",
        "Read policy.md to learn how the current books should be interpreted.",
        "Read ledger.jsonl as the append-only financial record.",
        "The ledger stores facts. The agent does the accounting.",
      ],
    },
    core_files: {
      program: {
        role: "Operating manual for the agent",
        path: support.program_path,
        exists: support.exists.program,
      },
      policy: {
        role: "Accounting policy for the current books",
        path: params.policyPath,
        exists: policyExists,
        readiness: policyReadiness.status,
        provisional_outputs: policyReadiness.provisional,
        reason: policyReadiness.reason,
      },
      ledger: {
        role: "Append-only financial record for the current books",
        path: params.ledgerPath,
        exists: ledgerExists,
      },
      event_schema: {
        role: "Canonical event envelope, field conventions, and event types",
        path: support.event_schema_path,
        exists: support.exists.event_schema,
      },
    },
    current_books: {
      books_dir: params.booksDir,
      resolution: params.resolution,
      exists: {
        books_dir: booksExist,
        ledger: ledgerExists,
        policy: policyExists,
      },
      available_examples: availablePolicyExamples(),
    },
    first_run: [
      "Run `clawbooks quickstart` when entering an unfamiliar repository or books directory.",
      "Read program.md.",
      "Read policy.md.",
      "Import normalized events with `clawbooks record` or `clawbooks batch`.",
      "Run `clawbooks verify` and `clawbooks reconcile` after imports when source totals are available.",
      "Use `clawbooks summary`, `clawbooks context`, `clawbooks documents`, `clawbooks assets`, and `clawbooks pack` to produce reports, checks, and audit-ready outputs.",
    ],
    workflow: {
      import: [
        "Inspect the source files and normalize them into clawbooks events.",
        "Preserve provenance such as data.ref, data.source_doc, data.source_row, data.source_hash, and data.provenance.",
        "Write events with `clawbooks record` or `clawbooks batch`.",
      ],
      validate: [
        "Use `clawbooks verify` for hash-chain, duplicate, sign, and balance checks.",
        "Use `clawbooks reconcile` to compare imported rows to statement or source totals.",
        "Use `clawbooks review` to surface events needing classification review.",
      ],
      produce_outputs: [
        "Use `clawbooks summary` for precomputed movement totals and report sections.",
        "Use `clawbooks context` for event-level reasoning, snapshot-aware analysis, and policy-guided interpretation.",
        "Use `clawbooks documents` for receivables, payables, settlement, and aging views.",
        "Use `clawbooks assets` for asset register and depreciation views.",
        "Use `clawbooks pack` for exportable audit packs.",
        "Combine these with policy.md to produce P&L, balance sheet, cash flow, tax views, reconciliations, management summaries, and custom reporting cuts.",
      ],
    },
    snapshot: {
      role: "Saved derived checkpoint event in the ledger",
      source_of_truth: false,
      command: "clawbooks snapshot <period> --save",
      explanation: "Snapshots store derived balances and reporting summaries to accelerate later reasoning, but the canonical record remains the append-only ledger.",
    },
    policy_lint: {
      status: lint.status,
      issue_count: lint.issues.length,
      suggestion_count: lint.suggestions.length,
      top_issues: lint.issues.slice(0, 3),
      top_suggestions: lint.suggestions.slice(0, 3),
    },
    next_steps: !ledgerExists && !policyExists ? [
      "Run `clawbooks init` in this folder, or pass `--books <dir>` to target an existing books directory.",
      "After init, read program.md and the policy path shown above before importing or reporting.",
      "Tailor policy.md to the entity, reporting basis, jurisdiction, and review rules before relying on outputs.",
    ] : policyReadiness.provisional ? [
      "Read program.md and the policy path shown above before reporting. The current policy appears generic or incomplete.",
      "Proceed only with explicit provisional language and call out material assumptions.",
      "Tighten policy.md before producing year-end or externally shared outputs.",
    ] : [
      "Read program.md and the policy path shown above before reporting.",
      "Use the policy file above as the authority for basis, recognition, categorization, and review rules.",
      "Run `clawbooks doctor` when you want mechanical setup diagnostics rather than workflow guidance.",
    ],
  }, null, 2));
}
