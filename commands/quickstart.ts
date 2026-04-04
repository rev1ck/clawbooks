import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availablePolicyExamples, packageSupportFiles, resolveProgramPath } from "../books.js";
import { classifyPolicyReadiness, lintPolicyText, policyText } from "../policy.js";
import { buildWorkflowStatus } from "../workflow-state.js";

export function cmdQuickstart(params: {
  booksDir: string | null;
  ledgerPath: string;
  policyPath: string;
  resolution: string;
}) {
  const support = packageSupportFiles();
  const program = resolveProgramPath(params.booksDir);
  const booksExist = params.booksDir ? existsSync(params.booksDir) : false;
  const ledgerExists = existsSync(params.ledgerPath);
  const policyExists = existsSync(params.policyPath);
  const policy = policyText(params.policyPath);
  const policyReadiness = classifyPolicyReadiness(policy, params.policyPath);
  const lint = lintPolicyText(policy, params.policyPath);
  const workflow = buildWorkflowStatus({ booksDir: params.booksDir, policyPath: params.policyPath });

  console.log(JSON.stringify({
    command: "quickstart",
    cwd: resolve("."),
    what_clawbooks_is: {
      summary: "Financial memory for agents: a ledger of facts and treatments, a policy for interpretation, and a program for operating the workflow.",
      mental_model: [
        "Read program.md to learn how clawbooks works.",
        "Read policy.md to learn how the current books should be interpreted.",
        "Read ledger.jsonl as the append-only financial record.",
        "The ledger stores facts and durable treatments. The agent does the accounting.",
      ],
    },
    core_files: {
      program: {
        role: "Operating manual for the agent",
        path: program.path,
        exists: program.exists,
        source: program.source,
        package_path: support.program_path,
      },
      policy: {
        role: "Accounting policy for the current books",
        path: params.policyPath,
        exists: policyExists,
        readiness: policyReadiness.status,
        provisional_outputs: policyReadiness.provisional,
        reason: policyReadiness.reason,
      },
      event_schema: {
        role: "Canonical event envelope and schema evolution reference",
        path: support.event_schema_path,
        exists: support.exists.event_schema,
      },
      ledger: {
        role: "Append-only financial record for the current books",
        path: params.ledgerPath,
        exists: ledgerExists,
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
    workflow_status: workflow,
    first_run: [
      "Run `clawbooks quickstart` when entering an unfamiliar repository or books directory.",
      "Read .books/program.md.",
      "Read .books/policy.md.",
      "Read event-schema.md if you are importing or revising event shapes.",
      "Inspect the raw source documents.",
      "Use `clawbooks import scaffold <kind>` if you want a mapper template before writing import code.",
      "Prefer importing full source coverage when practical; cut periods later for reporting and checks.",
      "For statement-shaped imports, run `clawbooks import check ... --statement ... --save-session` before append.",
      "Import normalized events with `clawbooks record` or `clawbooks batch`.",
      "Persist durable case-level accounting judgment as treatment events when it should survive later report runs.",
      "Run `clawbooks verify`, `clawbooks review`, and `clawbooks summary` after imports.",
      "Use `clawbooks summary`, `clawbooks context`, `clawbooks documents`, `clawbooks assets`, and `clawbooks pack` to produce reports, checks, and audit-ready outputs.",
    ],
    canonical_agent_prompt: [
      "Use clawbooks properly.",
      "Read `.books/program.md` and `.books/policy.md` before importing or reporting.",
      "Then inspect the source documents, import normalized facts, persist durable treatment events where needed, run verify/review/summary, and clearly distinguish policy-backed classifications from inferred ones.",
      "Do not treat bank inflows, transfers, exchange withdrawals, owner movements, hardware purchases, or tax flows as final P&L classifications unless policy supports that treatment.",
    ].join(" "),
    workflow: {
      import: [
        "Inspect the source files and normalize them into clawbooks events.",
        "Persist durable case-level accounting judgment as treatment events when it should be reused later.",
        "If you need a starting point, generate an editable template with `clawbooks import scaffold <kind>`.",
        "For a bank or card statement export, `statement-csv` is usually the right scaffold.",
        "For many opening balances, `opening-balances` is the shortest path to explicit starting facts.",
        "If recurring descriptions matter, keep optional factual hints in vendor-mappings.json and let the mapper consult that file.",
        "Preserve provenance such as data.ref, data.source_doc, data.source_row, data.source_hash, and data.provenance.",
        "Write events with `clawbooks record` or `clawbooks batch`.",
      ],
      validate: [
        "Use `clawbooks import check` to compare staged JSONL against statement expectations before append.",
        "Use `clawbooks verify` for hash-chain, duplicate, sign, and balance checks.",
        "Use `clawbooks reconcile` to compare imported rows to statement or source totals.",
        "Use `clawbooks review` to surface events needing classification review.",
      ],
      produce_outputs: [
        "Use `clawbooks summary` for precomputed movement totals and report sections.",
        "Use `clawbooks context` for event-level reasoning, snapshot-aware analysis, and policy-guided interpretation.",
        "Use `clawbooks documents` for receivables, payables, settlement, aging, and counterparty-grouped debtor/creditor views.",
        "Use `clawbooks assets` for treatment-backed asset register and depreciation views.",
        "Use `clawbooks pack` for exportable audit packs including persisted treatments.",
        "Combine these with policy.md to produce P&L, balance sheet, cash flow, tax views, reconciliations, and custom reporting cuts.",
      ],
    },
    import_support: {
      mappings: {
        role: "Optional recurring vendor/category hint file for import-time consistency",
        command_surface: [
          "clawbooks import mappings suggest",
          "clawbooks import mappings check",
        ],
        rule: "Vendor mappings are advisory operator aids. They do not override policy.md.",
      },
      sessions: {
        role: "Optional sidecar records of staged import validation runs",
        command: "clawbooks import check ... --save-session",
        storage: params.booksDir ? `${params.booksDir}/imports/sessions/*.json` : "clawbooks-import-sessions/*.json",
      },
      reconciliation: {
        role: "Dedicated statement reconciliation artifact for staged-vs-imported comparison",
        command: "clawbooks import reconcile <events.jsonl> --statement profile.json",
      },
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
      "Record workflow acknowledgment with `clawbooks workflow ack --program --policy` after reading those files.",
      "Use the policy file above as the authority for basis, recognition, categorization, and review rules.",
      "Use the event schema path above when adding new event shapes or upgrading import conventions.",
      "Run `clawbooks doctor` when you want mechanical setup diagnostics rather than workflow guidance.",
    ],
  }, null, 2));
}
