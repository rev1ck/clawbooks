import { filter, latestSnapshot, readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { sortByTimestamp } from "../reporting.js";
import { buildCompactContextSummary, buildContextSummary } from "../context.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

type ContextParams = {
  ledgerPath: string;
  policyPath: string;
  policyText: string;
};

export function cmdContext(args: string[], params: ContextParams) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(params.ledgerPath);
  const verbose = f.verbose === "true";
  const includePolicy = f["include-policy"] === "true";
  const allowProvisional = f["allow-provisional"] === "true";
  const workflowPaths = inferWorkflowPaths(params.ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: params.policyPath });

  const snapshot = latestSnapshot(all, after);
  const effectiveAfter = snapshot?.ts ?? after;
  const events = sortByTimestamp(filter(all, { after: effectiveAfter, before }).filter((e) => e.type !== "snapshot"));
  const summary = buildContextSummary(events, all);
  const summaryOut = verbose ? summary : buildCompactContextSummary(summary);
  const metadata = {
    schema_version: "clawbooks.context.v2",
    generated_at: new Date().toISOString(),
    ledger_path: params.ledgerPath,
    policy_path: params.policyPath,
    requested_window: {
      after: after ?? "all",
      before: before ?? "now",
    },
    effective_window: {
      after: effectiveAfter ?? "all",
      before: before ?? "now",
    },
    snapshot: snapshot ? {
      used: true,
      ts: snapshot.ts,
      source: snapshot.source,
      id: snapshot.id,
      event_count: Number(snapshot.data.event_count ?? 0),
    } : {
      used: false,
    },
    event_count: events.length,
    sources: summary.sources,
    event_types: summary.event_types,
    currencies: summary.currencies,
    workflow,
    provisional_override: allowProvisional,
  };

  console.log(`<context schema="clawbooks.context.v2">`);
  console.log(`<metadata>`);
  console.log(JSON.stringify(metadata, null, 2));
  console.log(`</metadata>`);
  console.log();

  console.log(`<instructions>`);
  console.log(`Read the policy first.`);
  if (workflow.reporting_readiness !== "ready" && workflow.warning) {
    console.log(`Workflow warning: ${workflow.warning}`);
    if (!allowProvisional) {
      console.log(`This context is provisional. Re-run with --allow-provisional if you intentionally want exploratory output before policy acknowledgment.`);
    }
  }
  console.log(`Use the policy path in metadata or run \`clawbooks policy\` to inspect the full policy text.`);
  if (snapshot) {
    console.log(`Treat the snapshot as the starting state up to its as_of timestamp.`);
    console.log(`Apply the events block on top of that snapshot to answer the user's question.`);
  } else {
    console.log(`No snapshot is present for this window, so reason directly from the events block.`);
  }
  console.log(`Prefer the summary block for orientation, and use the events block for transaction-level reasoning.`);
  if (!verbose) {
    console.log(`This is the compact context view. Use --verbose to print the full raw event payloads.`);
  }
  console.log(`Reclassify, correction, and confirm events are append-only audit events; use them when interpreting categories, field fixes, and review status.`);
  console.log(`Amounts are signed: inflows are positive, outflows are negative for known flow types. Document types (invoice, bill) are signed by direction.`);
  console.log(`</instructions>`);
  console.log();

  if (includePolicy) {
    console.log(`<policy>`);
    console.log(params.policyText);
    console.log(`</policy>`);
    console.log();
  }

  console.log(`<summary>`);
  console.log(JSON.stringify(summaryOut, null, 2));
  console.log(`</summary>`);
  console.log();

  if (snapshot) {
    console.log(`<snapshot as_of="${snapshot.ts}">`);
    console.log(JSON.stringify(snapshot.data, null, 2));
    console.log(`</snapshot>`);
    console.log();
  }

  console.log(`<events count="${events.length}" after="${effectiveAfter ?? "all"}" before="${before ?? "now"}" verbosity="${verbose ? "full" : "compact"}">`);
  for (const e of events) {
    if (verbose) {
      console.log(JSON.stringify(e));
      continue;
    }
    console.log(JSON.stringify({
      ts: e.ts,
      source: e.source,
      type: e.type,
      category: String(e.data.category ?? e.type),
      description: String(e.data.description ?? ""),
      amount: e.data.amount,
      currency: String(e.data.currency ?? ""),
      confidence: String(e.data.confidence ?? ""),
      id: e.id,
    }));
  }
  console.log(`</events>`);
  console.log(`</context>`);
}
