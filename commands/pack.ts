import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { buildPackData } from "../operations.js";
import { buildWorkflowStatus } from "../workflow-state.js";

type PackParams = {
  booksDir?: string;
  ledgerPath: string;
  policyPath: string;
};

export function cmdPack(args: string[], params: PackParams) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args, { policyPath: params.policyPath });
  const workflow = buildWorkflowStatus({ booksDir: params.booksDir ?? null, policyPath: params.policyPath });
  const allowProvisional = f["allow-provisional"] === "true";
  const allowPartialFx = f["allow-partial-fx"] === "true";
  if (workflow.reporting_mode !== "policy_grounded" && !allowProvisional) {
    console.error("Audit pack generation is provisional because the current run is not policy-grounded.");
    console.error("Run `clawbooks workflow ack --program --policy` and confirm a policy_* classification basis, or re-run with `--allow-provisional` if you intentionally want a provisional pack.");
    process.exit(1);
  }
  const pack = buildPackData({
    all: readAll(params.ledgerPath),
    after,
    before,
    source: f.source,
    baseCurrency: f["base-currency"],
    workflow,
    policyText: existsSync(params.policyPath) ? readFileSync(params.policyPath, "utf-8") : null,
  });
  if (f["base-currency"] && pack.summary.fx_coverage?.status !== "complete" && !allowPartialFx) {
    console.error(`Audit pack FX coverage is ${String(pack.summary.fx_coverage?.status ?? "none")} for requested base currency ${f["base-currency"]}.`);
    console.error("Re-run with `--allow-partial-fx` if you intentionally want a partial converted pack, or import explicit data.base_amount/data.base_currency facts first.");
    process.exit(1);
  }
  const packBase = params.booksDir ?? ".";
  const outDir = f.out ?? join(packBase, `audit-pack-${(before ?? new Date().toISOString()).slice(0, 10)}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/general_ledger.csv`, pack.general_ledger_csv, "utf-8");
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(pack.summary, null, 2) + "\n", "utf-8");
  writeFileSync(`${outDir}/verify.json`, JSON.stringify(pack.verify, null, 2) + "\n", "utf-8");
  writeFileSync(`${outDir}/workflow.json`, JSON.stringify(pack.workflow, null, 2) + "\n", "utf-8");
  if (pack.treatments_csv) writeFileSync(`${outDir}/treatments.csv`, pack.treatments_csv, "utf-8");
  if (pack.reclassifications_csv) writeFileSync(`${outDir}/reclassifications.csv`, pack.reclassifications_csv, "utf-8");
  if (pack.asset_register_csv) writeFileSync(`${outDir}/asset_register.csv`, pack.asset_register_csv, "utf-8");
  if (pack.policy_markdown !== null) writeFileSync(`${outDir}/policy.md`, pack.policy_markdown, "utf-8");
  if (pack.corrections_csv) writeFileSync(`${outDir}/corrections.csv`, pack.corrections_csv, "utf-8");
  if (pack.confirmations_csv) writeFileSync(`${outDir}/confirmations.csv`, pack.confirmations_csv, "utf-8");

  console.log(JSON.stringify({
    pack: outDir,
    workflow,
    reporting_mode: workflow.reporting_mode,
    classification_basis: workflow.classification_basis,
    workflow_warning: workflow.warning,
    provisional_override: allowProvisional,
    partial_fx_override: allowPartialFx,
    base_currency: f["base-currency"] ?? null,
    fx_coverage: pack.summary.fx_coverage ?? null,
    period: pack.period,
    events: pack.events,
    files: pack.file_names,
  }, null, 2));
}
