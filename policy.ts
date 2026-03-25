import { existsSync, readFileSync } from "node:fs";

type LintSeverity = "error" | "warn" | "info";

type LintCheck = {
  severity: LintSeverity;
  code: string;
  message: string;
};

export type FinancialYearEndHint = {
  raw: string | null;
  valid: boolean;
  month: number | null;
  day: number | null;
  error: string | null;
};

function pushCheck(
  checks: LintCheck[],
  bucket: string[],
  check: LintCheck,
) {
  if (checks.some((existing) => existing.code === check.code && existing.message === check.message)) return;
  checks.push(check);
  if (!bucket.includes(check.message)) bucket.push(check.message);
}

export function extractYamlHints(text: string): string | null {
  const match = text.match(/```yaml\s*([\s\S]*?)```/m);
  return match?.[1] ?? null;
}

export function extractHintValue(yaml: string | null, key: string): string | null {
  if (!yaml) return null;
  const match = yaml.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

export function extractReportingHintValue(text: string, key: string): string | null {
  const yaml = extractYamlHints(text);
  if (!yaml) return null;
  const reportingBlock = yaml.match(/^reporting:\s*\n((?:[ \t].*\n?)*)/m)?.[1] ?? null;
  return extractHintValue(reportingBlock, key);
}

export function parseFinancialYearEnd(rawValue: string | null | undefined): FinancialYearEndHint {
  if (!rawValue) {
    return {
      raw: null,
      valid: false,
      month: null,
      day: null,
      error: "Missing reporting.financial_year_end hint.",
    };
  }

  const raw = String(rawValue).trim();
  if (!/^\d{2}-\d{2}$/.test(raw)) {
    return {
      raw,
      valid: false,
      month: null,
      day: null,
      error: `Invalid reporting.financial_year_end "${raw}". Use zero-padded MM-DD.`,
    };
  }

  const [month, day] = raw.split("-").map(Number);
  if (month < 1 || month > 12) {
    return {
      raw,
      valid: false,
      month: null,
      day: null,
      error: `Invalid reporting.financial_year_end "${raw}". Month must be between 01 and 12.`,
    };
  }

  const maxDay = new Date(Date.UTC(2001, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) {
    return {
      raw,
      valid: false,
      month: null,
      day: null,
      error: `Invalid reporting.financial_year_end "${raw}". Day must be valid for month ${String(month).padStart(2, "0")}.`,
    };
  }

  return {
    raw,
    valid: true,
    month,
    day,
    error: null,
  };
}

export function financialYearEndFromPolicy(text: string): FinancialYearEndHint {
  return parseFinancialYearEnd(extractReportingHintValue(text, "financial_year_end"));
}

function hasHeading(text: string, heading: string): boolean {
  return new RegExp(`^## ${heading}$`, "m").test(text);
}

export function policyText(policyPath: string): string {
  if (!existsSync(policyPath)) return "No policy.md found.";
  return readFileSync(policyPath, "utf-8");
}

export function lintPolicyText(text: string, policyPath: string) {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const checks: LintCheck[] = [];
  const yamlHints = extractYamlHints(text);
  const basis = extractHintValue(yamlHints, "basis");
  const financialYearEnd = financialYearEndFromPolicy(text);
  const hasRevenueRecognition = hasHeading(text, "Revenue recognition");
  const hasExpenseRecognition = hasHeading(text, "Expense recognition");
  const hasArAp = hasHeading(text, "Accounts receivable / payable");
  const hasReconciliation = hasHeading(text, "Reconciliation");
  const hasDataConventions = hasHeading(text, "Data conventions");
  const hasReportingViews = hasHeading(text, "Reporting views");
  const hasStatementConventions = hasHeading(text, "Statement conventions");
  const statementSemantics = /(posting date|transaction date|closing balance|opening balance|statement period|newest[- ]first|statement_start|statement_end)/i.test(text);
  const workflows = {
    statements: statementSemantics,
    documents: /(invoice|bill|accounts receivable|accounts payable|accrual)/i.test(text),
    trading: /crypto|cost basis|lot|trade|fills/i.test(text),
    managementViews: /(management|tax|reporting view|alternate interpretation)/i.test(text),
    review: /confidence|materiality|review/i.test(text),
  };

  if (!existsSync(policyPath)) {
    pushCheck(checks, issues, {
      severity: "error",
      code: "missing_policy",
      message: "No policy file found.",
    });
  } else {
    if (!text.includes("```yaml")) {
      pushCheck(checks, issues, {
        severity: "error",
        code: "missing_yaml_hints",
        message: "Missing structured YAML hints block.",
      });
    }
    if (!/reporting:\s*\n[\s\S]*basis:/m.test(text)) {
      pushCheck(checks, issues, {
        severity: "error",
        code: "missing_reporting_basis",
        message: "Missing reporting.basis hint.",
      });
    }
    if (!/reporting:\s*\n[\s\S]*base_currency:/m.test(text)) {
      pushCheck(checks, issues, {
        severity: "error",
        code: "missing_base_currency",
        message: "Missing reporting.base_currency hint.",
      });
    }
    if (!/reporting:\s*\n[\s\S]*financial_year_end:/m.test(text)) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_financial_year_end",
        message: "Add a reporting.financial_year_end hint if you want fiscal-year shorthand such as FY2025.",
      });
    } else if (!financialYearEnd.valid && financialYearEnd.error) {
      pushCheck(checks, issues, {
        severity: "warn",
        code: "invalid_financial_year_end",
        message: financialYearEnd.error,
      });
    }
    if (!/entity:/m.test(text)) {
      pushCheck(checks, issues, {
        severity: "error",
        code: "missing_entity_hints",
        message: "Missing entity section in structured hints.",
      });
    }
    if (!hasHeading(text, "Entity")) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_entity_section",
        message: "Add a narrative '## Entity' section.",
      });
    }
    if (!hasRevenueRecognition) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_revenue_recognition",
        message: "Add a '## Revenue recognition' section.",
      });
    }
    if (!hasExpenseRecognition) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_expense_recognition",
        message: "Add an '## Expense recognition' section.",
      });
    }
    if (!hasArAp) {
      pushCheck(checks, suggestions, {
        severity: workflows.documents || basis === "accrual" ? "warn" : "info",
        code: "missing_ar_ap",
        message: "Add an '## Accounts receivable / payable' section if documents are used.",
      });
    }
    if (!hasReconciliation) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_reconciliation",
        message: "Add a '## Reconciliation' section with import checks.",
      });
    }
    if (!hasDataConventions) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_data_conventions",
        message: "Add a '## Data conventions' section for lots, FX, provenance, and agent identity.",
      });
    }
    if (workflows.managementViews && !hasReportingViews) {
      pushCheck(checks, suggestions, {
        severity: "warn",
        code: "missing_reporting_views",
        message: "If you maintain alternate interpretations such as management or tax views, add a short '## Reporting views' section.",
      });
    }
    if (workflows.statements && !hasStatementConventions) {
      pushCheck(checks, suggestions, {
        severity: "warn",
        code: "missing_statement_conventions",
        message: "If statements drive imports or reconciliations, add a concise '## Statement conventions' section for date basis and balance checks.",
      });
    }
    if (workflows.trading && !/lot_id|lot_ref|disposition_lots/i.test(text)) {
      pushCheck(checks, suggestions, {
        severity: "warn",
        code: "missing_lot_conventions",
        message: "Crypto/trading policy should define lot-tracking conventions such as data.lot_id or data.lot_ref.",
      });
    }
    if (workflows.trading && !/base_amount|fx_rate|price_usd|valuation_ts|price_source/i.test(text)) {
      pushCheck(checks, suggestions, {
        severity: "warn",
        code: "missing_fx_conventions",
        message: "Crypto/trading policy should define FX or valuation fields such as data.base_amount, data.fx_rate, or data.price_usd.",
      });
    }
    if (!/source_doc|provenance|source_row|source_hash/i.test(text)) {
      pushCheck(checks, suggestions, {
        severity: "warn",
        code: "missing_source_provenance",
        message: "Define provenance conventions such as data.source_doc, data.source_row, or data.provenance.",
      });
    }
    if (!/recorded_by|recorded_via|import_session/i.test(text)) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_write_provenance",
        message: "Define write provenance conventions such as data.recorded_by or data.import_session.",
      });
    }

    if (basis === "cash" && /invoice|bill|accounts receivable|accounts payable/i.test(text) && !/informational|tracking only|do not recognize/i.test(text)) {
      pushCheck(checks, issues, {
        severity: "warn",
        code: "cash_basis_document_ambiguity",
        message: "Policy says cash basis but also discusses invoices/bills without clarifying whether they are informational only or recognition-driving.",
      });
    }
    if (basis === "accrual" && (!hasRevenueRecognition || !hasExpenseRecognition)) {
      pushCheck(checks, issues, {
        severity: "warn",
        code: "accrual_basis_missing_recognition_sections",
        message: "Policy says accrual basis but does not clearly define both revenue and expense recognition.",
      });
    }
    if (workflows.review && !/materiality|threshold/i.test(text)) {
      pushCheck(checks, suggestions, {
        severity: "info",
        code: "missing_review_materiality",
        message: "If review confidence matters operationally, add a short note on materiality thresholds or escalation rules.",
      });
    }
  }

  const severityCounts = checks.reduce((acc, check) => {
    acc[check.severity]++;
    return acc;
  }, { error: 0, warn: 0, info: 0 });

  return {
    status: severityCounts.error === 0 && severityCounts.warn === 0 ? "ok" : "warn",
    policy_path: policyPath,
    issues,
    suggestions,
    checks,
    severity_counts: severityCounts,
    coverage: {
      structured_hints: Boolean(yamlHints),
      basis: basis ?? null,
      financial_year_end: {
        raw: financialYearEnd.raw,
        valid: financialYearEnd.valid,
        month: financialYearEnd.month,
        day: financialYearEnd.day,
        error: financialYearEnd.error,
      },
      sections: {
        entity: hasHeading(text, "Entity"),
        revenue_recognition: hasRevenueRecognition,
        expense_recognition: hasExpenseRecognition,
        accounts_receivable_payable: hasArAp,
        reconciliation: hasReconciliation,
        data_conventions: hasDataConventions,
        reporting_views: hasReportingViews,
        statement_conventions: hasStatementConventions,
      },
      workflows,
    },
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
