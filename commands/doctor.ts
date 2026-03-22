import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availablePolicyExamples, packageSupportFiles, resolveProgramPath } from "../books.js";
import { readAll } from "../ledger.js";
import { latestImportSession } from "../import-sessions.js";
import { policyText } from "../policy.js";
import { CLI_VERSION } from "../version.js";
import { buildWorkflowStatus, deriveReportingMode } from "../workflow-state.js";
import { buildDiagnostics } from "../operations.js";

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
  const canRead = ledgerExists;
  const canWrite = booksExist || params.booksDir !== null || params.resolution === "env:file" || params.resolution === "cwd:bare";
  const workflow = buildWorkflowStatus({ booksDir: params.booksDir, policyPath: params.policyPath });
  const all = ledgerExists ? readAll(params.ledgerPath) : [];
  const latestSession = latestImportSession(params.booksDir, params.policyPath);
  const importSessionsDir = params.booksDir ? resolve(params.booksDir, "imports", "sessions") : null;
  const importsDir = params.booksDir ? resolve(params.booksDir, "imports") : null;
  console.log(JSON.stringify(buildDiagnostics({
    booksDir: params.booksDir,
    ledgerPath: params.ledgerPath,
    policyPath: params.policyPath,
    resolution: params.resolution,
    cliVersion: CLI_VERSION,
    cwd: resolve("."),
    booksExist,
    ledgerExists,
    policyExists,
    canRead,
    canWrite,
    support,
    program,
    availableExamples: availablePolicyExamples(),
    workflow,
    all,
    policyText: policy,
    latestSession,
    importsDir,
    importSessionsDir,
  }), null, 2));
}
