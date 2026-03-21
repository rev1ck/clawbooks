import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { availablePolicyExamples, resolvePolicySeed, writePolicySeed, writeProgramSeed } from "../books.js";
import { flags } from "../cli-helpers.js";

type InitParams = {
  booksFlag?: string;
};

export function cmdInit(args: string[], params: InitParams) {
  const f = flags(args);
  const validExamples = ["default", "simple", "complex"];
  const availableExamples = availablePolicyExamples();
  if (f["list-examples"] === "true") {
    console.log(JSON.stringify({
      examples: [
        { name: "default", description: "General-purpose starter policy", available: availableExamples.includes("default") },
        { name: "simple", description: "Cash-basis operating business example", available: availableExamples.includes("simple") },
        { name: "complex", description: "Accrual/trading-heavy example", available: availableExamples.includes("complex") },
      ],
    }, null, 2));
    return;
  }
  if (f.example && !validExamples.includes(f.example)) {
    console.error(`Unknown policy example "${f.example}". Available examples: ${validExamples.join(", ")}`);
    process.exit(1);
  }
  const dir = resolve(f.books ?? params.booksFlag ?? ".books");
  const ledger = join(dir, "ledger.jsonl");
  const policy = join(dir, "policy.md");
  const program = join(dir, "program.md");
  const policySeed = resolvePolicySeed(f.example);
  const hadLedger = existsSync(ledger);
  const hadPolicy = existsSync(policy);
  const hadProgram = existsSync(program);

  mkdirSync(dir, { recursive: true });

  if (!hadLedger) {
    writeFileSync(ledger, "", "utf-8");
  }

  if (!hadPolicy) {
    writePolicySeed(policy, f.example);
  }
  if (!hadProgram) {
    writeProgramSeed(program);
  }

  if (hadLedger && hadPolicy && hadProgram) {
    console.log(`Books directory already exists at ${dir}`);
  } else {
    if (!hadLedger) console.log(`Created ${dir}/ledger.jsonl`);
    if (!hadPolicy) console.log(`Created ${dir}/policy.md`);
    if (!hadProgram) console.log(`Created ${dir}/program.md`);
  }

  console.log();
  console.log(`Books directory: ${dir}`);
  console.log(`Ledger: ${ledger}`);
  console.log(`Policy: ${policy}`);
  console.log(`Program: ${program}`);
  console.log(`Policy seed: ${policySeed.exampleName}`);
  console.log(`Available examples: ${availableExamples.join(", ") || "starter"}`);
  console.log();
  console.log("Next step: edit policy.md to match your entity, reporting basis, jurisdiction, and rules.");
  console.log("Read the book-local program.md so the working files all live in one place.");
  console.log("Treat the seeded example as a starting point, then tailor it to your preferences.");
  console.log("Next agent step: run `clawbooks quickstart` for workflow guidance, then `clawbooks doctor` for diagnostics.");
  console.log();
  console.log("Workflow reminder for agents:");
  console.log("1. Read .books/program.md");
  console.log("2. Read .books/policy.md");
  console.log("3. Inspect the source documents");
  console.log("4. Import normalized events");
  console.log("5. Run verify + review + summary");
  console.log("Reports generated before reading program.md and policy.md should be treated as heuristic and provisional.");
  console.log();
  console.log("Recommended .gitignore additions:");
  console.log(`  ${dir.startsWith("/") ? dir : dir.replace(/^\.\//, "")}/ledger*.jsonl`);
  console.log(`  ${dir.startsWith("/") ? dir : dir.replace(/^\.\//, "")}/audit-pack-*`);
}
