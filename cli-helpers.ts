import { existsSync, readFileSync } from "node:fs";
import { financialYearEndFromPolicy } from "./policy.js";

const SHORT_FLAGS: Record<string, string> = { S: "source", T: "type" };

function isValue(arg: string): boolean {
  if (arg.startsWith("--")) return false;
  if (arg.length === 2 && arg[0] === "-" && SHORT_FLAGS[arg[1]]) return false;
  return true;
}

export function flags(args: string[]): Record<string, string> {
  const f: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && isValue(args[i + 1])) {
      f[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (args[i].startsWith("--")) {
      f[args[i].slice(2)] = "true";
    } else if (args[i].length === 2 && args[i][0] === "-" && SHORT_FLAGS[args[i][1]]) {
      if (i + 1 < args.length && isValue(args[i + 1])) {
        f[SHORT_FLAGS[args[i][1]]] = args[i + 1];
        i++;
      }
    }
  }
  return f;
}

export function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (i + 1 < args.length && isValue(args[i + 1])) i++;
      continue;
    }
    if (args[i].length === 2 && args[i][0] === "-" && SHORT_FLAGS[args[i][1]]) {
      if (i + 1 < args.length && isValue(args[i + 1])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

export function normalizeDateBoundary(value: string, boundary: "after" | "before"): string {
  if (value.includes("T")) return value;
  if (/^\d{4}$/.test(value)) {
    return boundary === "after"
      ? `${value}-01-01T00:00:00.000Z`
      : `${value}-12-31T23:59:59.999Z`;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return boundary === "after"
      ? `${value}-01T00:00:00.000Z`
      : `${value}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return boundary === "after"
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`;
  }
  return value;
}

function fiscalYearRange(period: string, policyPath?: string): { after: string; before: string } {
  if (!/^FY\d{4}$/.test(period)) {
    throw new Error(`Invalid fiscal-year shorthand "${period}". Use FY2025.`);
  }
  if (!policyPath) {
    throw new Error(`Fiscal-year shorthand "${period}" requires a resolved policy.md path with reporting.financial_year_end.`);
  }
  if (!existsSync(policyPath)) {
    throw new Error(`Fiscal-year shorthand "${period}" requires a readable policy.md. No file found at ${policyPath}.`);
  }

  const hint = financialYearEndFromPolicy(readFileSync(policyPath, "utf-8"));
  if (!hint.valid || hint.month === null || hint.day === null) {
    throw new Error(hint.error
      ? `Fiscal-year shorthand "${period}" cannot be resolved: ${hint.error}`
      : `Fiscal-year shorthand "${period}" cannot be resolved from policy.md.`);
  }

  const endYear = Number(period.slice(2));
  const previousYearEnd = new Date(Date.UTC(endYear - 1, hint.month - 1, hint.day));
  previousYearEnd.setUTCDate(previousYearEnd.getUTCDate() + 1);
  const after = `${String(previousYearEnd.getUTCFullYear()).padStart(4, "0")}-${String(previousYearEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(previousYearEnd.getUTCDate()).padStart(2, "0")}T00:00:00.000Z`;
  const before = `${String(endYear).padStart(4, "0")}-${String(hint.month).padStart(2, "0")}-${String(hint.day).padStart(2, "0")}T23:59:59.999Z`;
  return { after, before };
}

function parsePeriod(period: string, opts?: { policyPath?: string }): { after: string; before: string } {
  if (/^FY\d{4}$/.test(period)) {
    return fiscalYearRange(period, opts?.policyPath);
  }
  if (period.includes("/")) {
    const [a, b] = period.split("/");
    return {
      after: normalizeDateBoundary(a, "after"),
      before: normalizeDateBoundary(b, "before"),
    };
  }
  return {
    after: normalizeDateBoundary(period, "after"),
    before: normalizeDateBoundary(period, "before"),
  };
}

export function periodFromArgs(args: string[], opts?: { policyPath?: string }): { after?: string; before?: string } {
  const f = flags(args);
  const p = positional(args);
  let after: string | undefined = f.after ? normalizeDateBoundary(f.after, "after") : undefined;
  let before: string | undefined = f.before ? normalizeDateBoundary(f.before, "before") : undefined;
  if (p[0]) {
    let period;
    try {
      period = parsePeriod(p[0], opts);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    after = after ?? period.after;
    before = before ?? period.before;
  }
  return { after, before };
}
