import { readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildContext } from "../operations.js";
import { buildWorkflowStatus, inferWorkflowPaths } from "../workflow-state.js";

type ContextParams = {
  ledgerPath: string;
  policyPath: string;
  policyText: string;
};

export function cmdContext(args: string[], params: ContextParams) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const context = buildContext({
    all: readAll(params.ledgerPath),
    after,
    before,
    baseCurrency: f["base-currency"],
    verbose: f.verbose === "true",
    includePolicy: f["include-policy"] === "true",
    allowProvisional: f["allow-provisional"] === "true",
    ledgerPath: params.ledgerPath,
    policyPath: params.policyPath,
    policyText: params.policyText,
    workflow: buildWorkflowStatus({ booksDir: inferWorkflowPaths(params.ledgerPath).booksDir, policyPath: params.policyPath }),
  });
  const workflowPaths = inferWorkflowPaths(params.ledgerPath);
  const workflow = buildWorkflowStatus({ booksDir: workflowPaths.booksDir, policyPath: params.policyPath });
  context.metadata.workflow = workflow;

  console.log(`<context schema="${context.metadata.schema_version}">`);
  console.log(`<metadata>`);
  console.log(JSON.stringify(context.metadata, null, 2));
  console.log(`</metadata>`);
  console.log();

  console.log(`<instructions>`);
  for (const line of context.instructions) console.log(line);
  console.log(`</instructions>`);
  console.log();

  if (context.policy_text !== null) {
    console.log(`<policy>`);
    console.log(context.policy_text);
    console.log(`</policy>`);
    console.log();
  }

  console.log(`<summary>`);
  console.log(JSON.stringify(context.summary, null, 2));
  console.log(`</summary>`);
  console.log();

  if (context.snapshot) {
    console.log(`<snapshot as_of="${context.snapshot.ts}">`);
    console.log(JSON.stringify(context.snapshot.data, null, 2));
    console.log(`</snapshot>`);
    console.log();
  }

  console.log(`<events count="${context.events.length}" after="${context.effective_after}" before="${context.effective_before}" verbosity="${context.verbosity}">`);
  for (const event of context.events) console.log(JSON.stringify(event));
  console.log(`</events>`);
  console.log(`</context>`);
}
