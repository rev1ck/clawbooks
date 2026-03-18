import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { availablePolicyExamples } from "../books.js";

export function cmdWhere(params: {
  booksDir: string | null;
  ledgerPath: string;
  policyPath: string;
  resolution: string;
}) {
  console.log(JSON.stringify({
    cwd: resolve("."),
    books_dir: params.booksDir,
    ledger_path: params.ledgerPath,
    policy_path: params.policyPath,
    resolution: params.resolution,
    exists: {
      books_dir: params.booksDir ? existsSync(params.booksDir) : false,
      ledger: existsSync(params.ledgerPath),
      policy: existsSync(params.policyPath),
    },
    available_examples: availablePolicyExamples(),
  }, null, 2));
}
