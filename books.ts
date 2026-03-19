import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const POLICY_EXAMPLES = {
  default: resolve(MODULE_DIR, "..", "policy.md.example"),
  simple: resolve(MODULE_DIR, "..", "policy-simple.md.example"),
  complex: resolve(MODULE_DIR, "..", "policy-complex.md.example"),
} as const;
const SUPPORT_FILES = {
  program: resolve(MODULE_DIR, "..", "program.md"),
  agentBootstrap: resolve(MODULE_DIR, "..", "agent-bootstrap.md"),
  eventSchema: resolve(MODULE_DIR, "..", "docs", "event-schema.md"),
} as const;

export type PolicyExampleName = keyof typeof POLICY_EXAMPLES;
export type BooksResolution =
  | "env:file"
  | "env:books"
  | "flag:books"
  | "walkup:.books"
  | "cwd:bare"
  | "default:.books";

export const DEFAULT_POLICY_TEMPLATE = `---
entity:
  name: Replace with your entity name
  entity_type: company
  jurisdiction: Replace with your jurisdiction
reporting:
  basis: cash          # or: accrual
  financial_year_end: 12-31
  base_currency: USD
tax:
  regime: Replace with your tax regime
---

# Accounting policy

Edit this file to match your entity before relying on reports.
The ledger stores financial facts; this policy tells the agent how to interpret them.

## Entity

Describe the entity, what it does, and any jurisdiction-specific conventions.

## Revenue recognition

State when revenue is recognized.

- Cash basis: recognize revenue when payment is received
- Accrual basis: recognize revenue when an invoice is issued or performance obligation is met

## Expense recognition

State when expenses are recognized.

- Cash basis: recognize expenses when paid
- Accrual basis: recognize expenses when bills/invoices are received or obligations arise

## Accounts receivable / payable

Explain how invoices, bills, and settlements should be interpreted.

## Tax and reporting notes

Add any filing, tax, capitalization, or review rules the agent should follow.
`;

export function availablePolicyExamples(): PolicyExampleName[] {
  return (Object.keys(POLICY_EXAMPLES) as PolicyExampleName[]).filter((name) => existsSync(POLICY_EXAMPLES[name]));
}

export function packageSupportFiles(): {
  program_path: string;
  agent_bootstrap_path: string;
  event_schema_path: string;
  exists: {
    program: boolean;
    agent_bootstrap: boolean;
    event_schema: boolean;
  };
} {
  return {
    program_path: SUPPORT_FILES.program,
    agent_bootstrap_path: SUPPORT_FILES.agentBootstrap,
    event_schema_path: SUPPORT_FILES.eventSchema,
    exists: {
      program: existsSync(SUPPORT_FILES.program),
      agent_bootstrap: existsSync(SUPPORT_FILES.agentBootstrap),
      event_schema: existsSync(SUPPORT_FILES.eventSchema),
    },
  };
}

export function resolvePolicySeed(example?: string): { source: "example" | "fallback"; exampleName: string; path?: string } {
  const requested = example as PolicyExampleName | undefined;
  if (requested && requested in POLICY_EXAMPLES && existsSync(POLICY_EXAMPLES[requested])) {
    return { source: "example", exampleName: requested, path: POLICY_EXAMPLES[requested] };
  }
  if (existsSync(POLICY_EXAMPLES.default)) {
    return { source: "example", exampleName: requested ?? "default", path: POLICY_EXAMPLES.default };
  }
  return { source: "fallback", exampleName: requested ?? "starter" };
}

export function resolveBooks(booksFlag?: string): {
  ledger: string;
  policy: string;
  booksDir: string | null;
  resolution: BooksResolution;
} {
  if (process.env.CLAWBOOKS_LEDGER || process.env.CLAWBOOKS_POLICY) {
    const ledger = process.env.CLAWBOOKS_LEDGER ?? "./ledger.jsonl";
    const policy = process.env.CLAWBOOKS_POLICY ?? "./policy.md";
    return { ledger, policy, booksDir: null, resolution: "env:file" };
  }

  const booksEnv = process.env.CLAWBOOKS_BOOKS;
  if (booksEnv) {
    const dir = resolve(booksEnv);
    return { ledger: join(dir, "ledger.jsonl"), policy: join(dir, "policy.md"), booksDir: dir, resolution: "env:books" };
  }

  if (booksFlag) {
    const dir = resolve(booksFlag);
    return { ledger: join(dir, "ledger.jsonl"), policy: join(dir, "policy.md"), booksDir: dir, resolution: "flag:books" };
  }

  let cur = resolve(".");
  while (true) {
    const candidate = join(cur, ".books");
    if (existsSync(join(candidate, "ledger.jsonl")) || existsSync(join(candidate, "policy.md"))) {
      return {
        ledger: join(candidate, "ledger.jsonl"),
        policy: join(candidate, "policy.md"),
        booksDir: candidate,
        resolution: "walkup:.books",
      };
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  if (existsSync("./ledger.jsonl")) {
    return { ledger: "./ledger.jsonl", policy: "./policy.md", booksDir: null, resolution: "cwd:bare" };
  }

  const defaultDir = resolve(".books");
  return { ledger: join(defaultDir, "ledger.jsonl"), policy: join(defaultDir, "policy.md"), booksDir: defaultDir, resolution: "default:.books" };
}

export function ensureBooksDir(booksDir: string | null, ledger: string, policy: string): void {
  if (booksDir && !existsSync(booksDir)) {
    mkdirSync(booksDir, { recursive: true });
  }
  if (!existsSync(ledger)) {
    writeFileSync(ledger, "", "utf-8");
  }
  if (!existsSync(policy)) {
    writePolicySeed(policy);
  }
}

export function writePolicySeed(policyPath: string, example?: string): { source: "example" | "fallback"; exampleName: string; path?: string } {
  const policySeed = resolvePolicySeed(example);
  if (policySeed.source === "example" && policySeed.path) {
    copyFileSync(policySeed.path, policyPath);
  } else {
    writeFileSync(policyPath, DEFAULT_POLICY_TEMPLATE, "utf-8");
  }
  return policySeed;
}

export function requireBooks(ledger: string): void {
  if (!existsSync(ledger)) {
    console.error("No books found. Run `clawbooks init` to create a .books/ directory,");
    console.error("or use --books <dir> / CLAWBOOKS_BOOKS to point to an existing one.");
    console.error(`Expected ledger path: ${ledger}`);
    process.exit(1);
  }
}
