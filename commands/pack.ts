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
  const { after, before } = periodFromArgs(args);
  const workflow = buildWorkflowStatus({ booksDir: params.booksDir ?? null, policyPath: params.policyPath });
  const allowProvisional = f["allow-provisional"] === "true";
  if (workflow.reporting_mode !== "policy_grounded" && !allowProvisional) {
    console.error("Audit pack generation is provisional because the current run is not policy-grounded.");
    console.error("Run `clawbooks workflow ack --program --policy` and confirm a policy_* classification basis, or re-run with `--allow-provisional` if you intentionally want a provisional pack.");
    process.exit(1);
  }
  const packBase = params.booksDir ?? ".";
  const outDir = f.out ?? join(packBase, `audit-pack-${(before ?? new Date().toISOString()).slice(0, 10)}`);
  mkdirSync(outDir, { recursive: true });
  const pack = buildPackData({
    all: readAll(params.ledgerPath),
    after,
    before,
    source: f.source,
    workflow,
    policyText: existsSync(params.policyPath) ? readFileSync(params.policyPath, "utf-8") : null,
  });
  writeFileSync(`${outDir}/general_ledger.csv`, pack.general_ledger_csv, "utf-8");
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(pack.summary, null, 2) + "\n", "utf-8");
  writeFileSync(`${outDir}/verify.json`, JSON.stringify(pack.verify, null, 2) + "\n", "utf-8");
  writeFileSync(`${outDir}/workflow.json`, JSON.stringify(pack.workflow, null, 2) + "\n", "utf-8");
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
    period: pack.period,
    events: pack.events,
    files: pack.file_names,
  }, null, 2));
}
