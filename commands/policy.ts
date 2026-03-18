import { flags, positional } from "../cli-helpers.js";
import { lintPolicyText, policyText } from "../policy.js";

export function cmdPolicy(args: string[], policyPath: string) {
  const f = flags(args);
  const p = positional(args);
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
