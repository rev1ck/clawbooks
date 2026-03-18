import { filter, readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { round2, sortByTimestamp } from "../reporting.js";
import { META_TYPES } from "../event-types.js";

export function cmdReconcile(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);

  if (!f.source) {
    console.error("Usage: clawbooks reconcile [period] --source S [--count N] [--debits N] [--credits N] [--currency C]");
    process.exit(1);
  }

  const all = readAll(ledgerPath);
  let events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  if (f.currency) {
    events = events.filter((e) => String(e.data.currency) === f.currency);
  }

  let actualDebits = 0;
  let actualCredits = 0;
  for (const e of events) {
    const amount = Number(e.data.amount);
    if (!isNaN(amount)) {
      if (amount < 0) {
        actualDebits = round2(actualDebits + amount);
      } else {
        actualCredits = round2(actualCredits + amount);
      }
    }
  }

  const expected: Record<string, number> = {};
  const actual: Record<string, number> = {};
  const differences: Record<string, number> = {};
  const issues: string[] = [];
  let status = "NO_EXPECTATIONS";

  if (f.count !== undefined) {
    expected.count = parseInt(f.count);
    actual.count = events.length;
    differences.count = actual.count - expected.count;
    if (differences.count !== 0) issues.push(`Count mismatch: expected ${expected.count}, got ${actual.count}`);
    status = "RECONCILED";
  }

  if (f.debits !== undefined) {
    expected.debits = parseFloat(f.debits);
    actual.debits = actualDebits;
    differences.debits = round2(actual.debits - expected.debits);
    if (Math.abs(differences.debits) > 0.01) issues.push(`Debits mismatch: expected ${expected.debits}, got ${actual.debits}`);
    status = "RECONCILED";
  }

  if (f.credits !== undefined) {
    expected.credits = parseFloat(f.credits);
    actual.credits = actualCredits;
    differences.credits = round2(actual.credits - expected.credits);
    if (Math.abs(differences.credits) > 0.01) issues.push(`Credits mismatch: expected ${expected.credits}, got ${actual.credits}`);
    status = "RECONCILED";
  }

  if (issues.length > 0) status = "MISMATCH";

  let gaps: string[] | undefined;
  if (f.gaps === "true") {
    gaps = [];
    const dates = events
      .filter((e) => !META_TYPES.has(e.type))
      .map((e) => e.ts.slice(0, 10))
      .filter((d, i, a) => a.indexOf(d) === i)
      .sort();
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) {
        gaps.push(`${dates[i - 1]} → ${dates[i]} (${diffDays} days)`);
      }
    }
  }

  console.log(JSON.stringify({
    expected, actual, differences, status, issues,
    ...(gaps ? { gaps } : {}),
  }, null, 2));
}
