import { existsSync, readFileSync } from "node:fs";
import { flags, positional } from "../cli-helpers.js";

function policyText(policyPath: string): string {
  if (!existsSync(policyPath)) return "No policy.md found.";
  return readFileSync(policyPath, "utf-8");
}

export function cmdPolicy(args: string[], policyPath: string) {
  const f = flags(args);
  const p = positional(args);
  if (p[0] === "lint") {
    const text = policyText(policyPath);
    const issues: string[] = [];
    const suggestions: string[] = [];
    if (!existsSync(policyPath)) {
      issues.push("No policy file found.");
    } else {
      if (!text.includes("```yaml")) issues.push("Missing structured YAML hints block.");
      if (!/reporting:\s*\n[\s\S]*basis:/m.test(text)) issues.push("Missing reporting.basis hint.");
      if (!/reporting:\s*\n[\s\S]*base_currency:/m.test(text)) issues.push("Missing reporting.base_currency hint.");
      if (!/entity:/m.test(text)) issues.push("Missing entity section in structured hints.");
      if (!/^## Entity$/m.test(text)) suggestions.push("Add a narrative '## Entity' section.");
      if (!/^## Revenue recognition$/m.test(text)) suggestions.push("Add a '## Revenue recognition' section.");
      if (!/^## Accounts receivable \/ payable$/m.test(text)) suggestions.push("Add an '## Accounts receivable / payable' section if documents are used.");
      if (!/^## Reconciliation$/m.test(text)) suggestions.push("Add a '## Reconciliation' section with import checks.");
      if (!/^## Data conventions$/m.test(text)) suggestions.push("Add a '## Data conventions' section for lots, FX, provenance, and agent identity.");
      const mentionsCrypto = /crypto|cost basis|lot/i.test(text);
      if (mentionsCrypto && !/lot_id|lot_ref|disposition_lots/i.test(text)) {
        suggestions.push("Crypto/trading policy should define lot-tracking conventions such as data.lot_id or data.lot_ref.");
      }
      if (mentionsCrypto && !/fx_rate|price_usd|valuation_ts|price_source/i.test(text)) {
        suggestions.push("Crypto/trading policy should define FX or valuation fields such as data.fx_rate or data.price_usd.");
      }
      if (!/source_doc|provenance|source_row|source_hash/i.test(text)) {
        suggestions.push("Define provenance conventions such as data.source_doc, data.source_row, or data.provenance.");
      }
      if (!/recorded_by|recorded_via|import_session/i.test(text)) {
        suggestions.push("Define write provenance conventions such as data.recorded_by or data.import_session.");
      }
    }
    const status = issues.length === 0 && suggestions.length === 0 ? "ok" : "warn";
    console.log(JSON.stringify({
      status,
      policy_path: policyPath,
      issues,
      suggestions,
    }, null, 2));
    return;
  }
  if (f.path === "true") {
    console.log(policyPath);
    return;
  }
  console.log(policyText(policyPath));
}
