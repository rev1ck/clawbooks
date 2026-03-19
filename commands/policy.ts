import { readFileSync } from "node:fs";
import { availablePolicyExamples, resolvePolicySeed } from "../books.js";
import { flags, positional } from "../cli-helpers.js";
import { lintPolicyText, policyText } from "../policy.js";

export function cmdPolicy(args: string[], policyPath: string) {
  const f = flags(args);
  const p = positional(args);
  const validExamples = ["default", "simple", "complex"];
  if (f["list-examples"] === "true") {
    const available = availablePolicyExamples();
    console.log(JSON.stringify({
      examples: [
        { name: "default", description: "General-purpose starter policy", available: available.includes("default") },
        { name: "simple", description: "Cash-basis operating business example", available: available.includes("simple") },
        { name: "complex", description: "Accrual/trading-heavy example", available: available.includes("complex") },
      ],
      usage: {
        print_example: "clawbooks policy --example simple",
        print_example_path: "clawbooks policy --example-path simple",
      },
    }, null, 2));
    return;
  }
  if (f.example) {
    if (!validExamples.includes(f.example)) {
      console.error(`Unknown policy example "${f.example}". Available examples: ${validExamples.join(", ")}`);
      process.exit(1);
    }
    const seed = resolvePolicySeed(f.example);
    if (!seed.path) {
      console.error(`No bundled example available for "${f.example}".`);
      process.exit(1);
    }
    console.log(readFileSync(seed.path, "utf-8"));
    return;
  }
  if (f["example-path"]) {
    if (!validExamples.includes(f["example-path"])) {
      console.error(`Unknown policy example "${f["example-path"]}". Available examples: ${validExamples.join(", ")}`);
      process.exit(1);
    }
    const seed = resolvePolicySeed(f["example-path"]);
    if (!seed.path) {
      console.error(`No bundled example available for "${f["example-path"]}".`);
      process.exit(1);
    }
    console.log(seed.path);
    return;
  }
  if (p[0] === "lint") {
    console.log(JSON.stringify(lintPolicyText(policyText(policyPath), policyPath), null, 2));
    return;
  }
  if (f.path === "true") {
    console.log(policyPath);
    return;
  }
  console.log(policyText(policyPath));
}
