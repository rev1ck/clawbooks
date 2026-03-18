import { createHash } from "node:crypto";
import { filter, hashLine, readAll } from "../ledger.js";
import { flags, periodFromArgs } from "../cli-helpers.js";
import { round2, sortByTimestamp } from "../reporting.js";
import { ASSET_EVENT_TYPES, DOCUMENT_TYPES, INFLOW_TYPES, META_TYPES, OUTFLOW_TYPES } from "../event-types.js";

export function cmdVerify(args: string[], ledgerPath: string) {
  const f = flags(args);
  const { after, before } = periodFromArgs(args);
  const all = readAll(ledgerPath);
  const isFiltered = !!(f.source || after || before);
  const events = sortByTimestamp(filter(all, { after, before, source: f.source }));

  const byType: Record<string, { count: number; total: number }> = {};
  const bySource: Record<string, { count: number; total: number }> = {};
  const byCurrency: Record<string, { count: number; debits: number; credits: number }> = {};
  const issues: string[] = [];
  let debits = 0;
  let credits = 0;

  for (const e of events) {
    if (!byType[e.type]) byType[e.type] = { count: 0, total: 0 };
    byType[e.type].count++;

    if (!bySource[e.source]) bySource[e.source] = { count: 0, total: 0 };
    bySource[e.source].count++;

    const amount = Number(e.data.amount);
    if (e.data.amount !== undefined && isNaN(amount)) {
      issues.push(`Event ${e.id}: non-numeric amount "${e.data.amount}"`);
    } else if (e.data.amount !== undefined) {
      byType[e.type].total = round2(byType[e.type].total + amount);
      bySource[e.source].total = round2(bySource[e.source].total + amount);

      if (amount < 0) {
        debits = round2(debits + amount);
      } else {
        credits = round2(credits + amount);
      }

      const currency = String(e.data.currency ?? "UNKNOWN");
      if (!byCurrency[currency]) byCurrency[currency] = { count: 0, debits: 0, credits: 0 };
      byCurrency[currency].count++;
      if (amount < 0) {
        byCurrency[currency].debits = round2(byCurrency[currency].debits + amount);
      } else {
        byCurrency[currency].credits = round2(byCurrency[currency].credits + amount);
      }
    }

    if (e.data.amount !== undefined && !isNaN(amount)) {
      if (OUTFLOW_TYPES.has(e.type) && amount > 0) {
        issues.push(`Event ${e.id}: outflow type "${e.type}" has positive amount ${amount}`);
      } else if (INFLOW_TYPES.has(e.type) && amount < 0) {
        issues.push(`Event ${e.id}: inflow type "${e.type}" has negative amount ${amount}`);
      } else if (DOCUMENT_TYPES.has(e.type)) {
        if (e.data.direction === "issued" && amount < 0) {
          issues.push(`Event ${e.id}: document type "${e.type}" with direction "issued" has negative amount ${amount}`);
        } else if (e.data.direction === "received" && amount > 0) {
          issues.push(`Event ${e.id}: document type "${e.type}" with direction "received" has positive amount ${amount}`);
        }
      }
    }

    if (!e.source) issues.push(`Event ${e.id}: missing source`);
    if (!e.type) issues.push(`Event ${e.id}: missing type`);
    if (!e.data || typeof e.data !== "object") issues.push(`Event ${e.id}: missing or invalid data`);
  }

  let chain_valid = true;
  if (!isFiltered) {
    for (let i = 0; i < all.length; i++) {
      if (i === 0) {
        if (all[i].prev !== "genesis") {
          issues.push(`Event ${all[i].id}: first event prev should be "genesis", got "${all[i].prev}"`);
          chain_valid = false;
        }
      } else {
        const expectedPrev = hashLine(JSON.stringify({ ...all[i - 1] }));
        if (all[i].prev !== expectedPrev) {
          issues.push(`Event ${all[i].id}: chain break at index ${i} (expected prev ${expectedPrev}, got ${all[i].prev})`);
          chain_valid = false;
        }
      }
    }
  }

  let balanceCheck: {
    expected: number;
    actual: number;
    difference: number;
    matches: boolean;
    opening_balance?: number;
    net_movement?: number;
    closing_balance?: number;
  } | undefined;
  if (f.balance !== undefined) {
    const expectedBalance = parseFloat(f.balance);
    const openingBalance = f["opening-balance"] !== undefined ? parseFloat(f["opening-balance"]) : 0;
    let movement = 0;
    for (const e of events) {
      if (META_TYPES.has(e.type)) continue;
      const amount = Number(e.data.amount);
      if (isNaN(amount)) continue;
      if (f.currency && String(e.data.currency) !== f.currency) continue;
      movement = round2(movement + amount);
    }
    const actual = round2(openingBalance + movement);
    const difference = round2(actual - expectedBalance);
    const matches = Math.abs(difference) < 0.01;
    balanceCheck = { expected: expectedBalance, actual, difference, matches };
    if (!matches) {
      issues.push(`Balance mismatch: expected ${expectedBalance}, got ${actual} (difference: ${difference})`);
    }
    if (f["opening-balance"] !== undefined) {
      Object.assign(balanceCheck, {
        opening_balance: openingBalance,
        net_movement: movement,
        closing_balance: actual,
      });
    }
  }

  const dupGroups: Record<string, string[]> = {};
  for (const e of events) {
    if (META_TYPES.has(e.type) || ASSET_EVENT_TYPES.has(e.type)) continue;
    const key = `${e.source}|${e.ts.slice(0, 10)}|${e.data.amount}|${e.data.description ?? ""}`;
    if (!dupGroups[key]) dupGroups[key] = [];
    dupGroups[key].push(e.id);
  }
  const potentialDuplicates = Object.values(dupGroups).filter((ids) => ids.length > 1);

  const hash = createHash("sha256")
    .update(events.map((e) => e.id).join(","))
    .digest("hex");

  console.log(JSON.stringify({
    event_count: events.length,
    by_type: byType,
    by_source: bySource,
    by_currency: byCurrency,
    debits: round2(debits),
    credits: round2(credits),
    ...(isFiltered ? {} : { chain_valid }),
    ...(balanceCheck ? { balance_check: balanceCheck } : {}),
    ...(potentialDuplicates.length > 0 ? { potential_duplicates: potentialDuplicates } : {}),
    hash,
    issues,
  }, null, 2));
}
