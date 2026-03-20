import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availablePolicyExamples, packageSupportFiles, resolveProgramPath } from "../books.js";
import { latestSnapshot, readAll } from "../ledger.js";
import { META_TYPES } from "../event-types.js";
import { classifyPolicyReadiness, lintPolicyText, policyText } from "../policy.js";
import { CLI_VERSION } from "../version.js";
import { analyzeVerification } from "./verify.js";

export function cmdDoctor(params: {
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
  const canRead = ledgerExists;
  const canWrite = booksExist || params.booksDir !== null || params.resolution === "env:file" || params.resolution === "cwd:bare";
  const hasSupportFiles = support.exists.program && support.exists.agent_bootstrap && support.exists.event_schema;
  const all = ledgerExists ? readAll(params.ledgerPath) : [];
  const verification = ledgerExists ? analyzeVerification(all) : null;
  const nonMetaEvents = all.filter((e) => !META_TYPES.has(e.type));
  const openingBalances = all.filter((e) => e.type === "opening_balance");
  const snapshots = all.filter((e) => e.type === "snapshot");
  const latestLedgerSnapshot = latestSnapshot(all);
  const latestEventTs = all.length > 0 ? all[all.length - 1].ts : null;
  const latestNonSnapshotTs = [...all].reverse().find((e) => e.type !== "snapshot")?.ts ?? null;
  const provenanceKeys = ["ref", "source_doc", "source_row", "source_hash", "provenance"];
  const eventsWithoutProvenance = nonMetaEvents.filter((e) => provenanceKeys.every((key) => e.data[key] === undefined));
  const duplicateGroups = verification?.potential_duplicates?.length ?? 0;
  const chainValid = verification?.chain_valid ?? null;
  const issueCount = verification?.issues.length ?? 0;
  const importSessionsDir = params.booksDir ? resolve(params.booksDir, "imports", "sessions") : null;
  const importsDir = params.booksDir ? resolve(params.booksDir, "imports") : null;

  let snapshotStatus = "none";
  let snapshotReason = "No snapshot events found in the ledger.";
  if (latestLedgerSnapshot && latestNonSnapshotTs) {
    if (latestLedgerSnapshot.ts >= latestNonSnapshotTs) {
      snapshotStatus = "current";
      snapshotReason = "A snapshot exists at or after the latest non-snapshot event.";
    } else {
      snapshotStatus = "stale";
      snapshotReason = "A snapshot exists, but newer non-snapshot events were added after it.";
    }
  } else if (latestLedgerSnapshot) {
    snapshotStatus = "current";
    snapshotReason = "Only snapshot events are present in the ledger.";
  }

  const operatorWarnings: string[] = [];
  if (ledgerExists && all.length === 0) {
    operatorWarnings.push("Ledger exists but is empty. Import events before relying on reports.");
  }
  if (ledgerExists && nonMetaEvents.length > 0 && openingBalances.length === 0 && snapshots.length === 0) {
    operatorWarnings.push("No opening_balance or snapshot events found. Balance-sheet style outputs may be incomplete.");
  }
  if (eventsWithoutProvenance.length > 0) {
    operatorWarnings.push(`${eventsWithoutProvenance.length} non-meta events have no provenance fields such as data.ref, data.source_doc, or data.source_hash.`);
  }
  if (duplicateGroups > 0) {
    operatorWarnings.push(`${duplicateGroups} potential duplicate group(s) detected. Review verify output before reporting.`);
  }
  if (policyReadiness.provisional) {
    operatorWarnings.push("Policy is still starter/provisional. External outputs should be marked provisional.");
  }
  if (snapshotStatus === "none" && nonMetaEvents.length >= 25) {
    operatorWarnings.push("No snapshot has been saved yet. Consider `clawbooks snapshot <period> --save` after a reporting run.");
  }
  if (snapshotStatus === "stale") {
    operatorWarnings.push("Snapshot is stale relative to the latest ledger activity.");
  }

  console.log(JSON.stringify({
    command: "doctor",
    cli_version: CLI_VERSION,
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
      resolved_program: program,
      available_examples: availablePolicyExamples(),
    },
    status: {
      initialized: ledgerExists || policyExists,
      can_read_books: canRead,
      can_write_books: canWrite,
      support_files_present: hasSupportFiles,
    },
    ledger_health: !ledgerExists ? {
      present: false,
    } : {
      present: true,
      event_count: all.length,
      non_meta_event_count: nonMetaEvents.length,
      chain_valid: chainValid,
      verification_issue_count: issueCount,
      potential_duplicate_groups: duplicateGroups,
      hash: verification?.hash,
      first_event_ts: all[0]?.ts ?? null,
      last_event_ts: latestEventTs,
    },
    snapshot_health: {
      count: snapshots.length,
      latest_ts: latestLedgerSnapshot?.ts ?? null,
      status: snapshotStatus,
      reason: snapshotReason,
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
        program: program.exists ? "ok" : "missing",
        agent_bootstrap: support.exists.agent_bootstrap ? "ok" : "missing",
        event_schema: support.exists.event_schema ? "ok" : "missing",
      },
      ledger_integrity: verification ? {
        chain_valid: verification.chain_valid,
        issue_count: verification.issues.length,
        top_issues: verification.issues.slice(0, 5),
        potential_duplicates: verification.potential_duplicates ?? [],
      } : null,
      operator_mistakes: {
        warning_count: operatorWarnings.length,
        warnings: operatorWarnings,
      },
      import_workflow: {
        import_scaffolds_dir: importsDir,
        import_sessions_dir: importSessionsDir,
        recommendations: [
          "Use `clawbooks import scaffold <kind>` when starting a new importer.",
          "Use `clawbooks import check ... --statement ... --save-session` before appending staged statement imports.",
          "Use `clawbooks import mappings suggest` or `clawbooks import mappings check` only as optional factual consistency aids.",
          "Prefer importing full source coverage when practical and applying report periods later.",
          "Keep vendor mappings near the scaffold or in .books/vendor-mappings.json so import check can discover them.",
        ],
      },
    },
    suggested_next_command: "clawbooks quickstart",
    notes: [
      "Use `clawbooks quickstart` for workflow guidance, core file roles, and reporting capabilities.",
      support.exists.event_schema
        ? "Schema reference present: event-schema.md is packaged and available."
        : "Schema reference missing: event-schema.md was not found in package support files.",
      !ledgerExists && !policyExists
        ? "No books were found yet. Run `clawbooks init` or point clawbooks at an existing books directory."
        : "Books were resolved successfully. Review the policy diagnostics above before relying on outputs.",
    ],
    agent_bootstrap: {
      prompt_file: support.agent_bootstrap_path,
    },
  }, null, 2));
}
