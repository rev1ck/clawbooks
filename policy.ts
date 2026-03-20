import { existsSync, readFileSync } from "node:fs";

export function policyText(policyPath: string): string {
  if (!existsSync(policyPath)) return "No policy.md found.";
  return readFileSync(policyPath, "utf-8");
}

export function lintPolicyText(text: string, policyPath: string) {
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
    if (/(management|tax|reporting view|alternate interpretation)/i.test(text) && !/^## Reporting views$/m.test(text)) {
      suggestions.push("If you maintain alternate interpretations such as management or tax views, add a short '## Reporting views' section.");
    }
    if (/(statement|posting date|transaction date|closing balance|opening balance)/i.test(text) && !/^## Statement conventions$/m.test(text)) {
      suggestions.push("If statements drive imports or reconciliations, add a concise '## Statement conventions' section for date basis and balance checks.");
    }
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

  return {
    status: issues.length === 0 && suggestions.length === 0 ? "ok" : "warn",
    policy_path: policyPath,
    issues,
    suggestions,
  } as const;
}

export function classifyPolicyReadiness(text: string, policyPath: string) {
  if (!existsSync(policyPath)) {
    return {
      status: "missing",
      provisional: true,
      reason: "No policy file exists yet.",
    } as const;
  }

  const lint = lintPolicyText(text, policyPath);

  const genericSignals = [
    /Replace with your entity name/,
    /Replace with your jurisdiction/,
    /Replace with your tax regime/,
    /Edit this file to match your entity before relying on reports\./,
    /Example Studio LLC/,
    /Example Trading Operation/,
  ];

  const genericHits = genericSignals.filter((pattern) => pattern.test(text)).length;
  const hasStructuredHints = text.includes("```yaml") && /reporting:\s*\n[\s\S]*basis:/m.test(text);
  const hasEntitySpecificDetails = !/Replace with your/.test(text);

  if (genericHits > 0 || !hasStructuredHints || !hasEntitySpecificDetails || lint.status === "warn") {
    return {
      status: "starter",
      provisional: true,
      reason: "Policy appears to still be a starter/example policy or is incomplete enough that outputs should be treated as provisional.",
    } as const;
  }

  return {
    status: "customized",
    provisional: false,
    reason: "Policy appears entity-specific enough for normal agent use.",
  } as const;
}
