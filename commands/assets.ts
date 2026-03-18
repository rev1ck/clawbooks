import { readAll } from "../ledger.js";
import { buildAssetRegister } from "../assets.js";
import { flags } from "../cli-helpers.js";
import { round2 } from "../reporting.js";

export function cmdAssets(args: string[], ledgerPath: string) {
  const f = flags(args);
  const all = readAll(ledgerPath);
  const categoryFilter = f.category;
  const defaultLife = parseInt(f.life ?? "36");
  const asOf = f["as-of"] ?? new Date().toISOString();
  const register = buildAssetRegister(all, {
    category: categoryFilter,
    defaultLife,
    asOf,
  });

  const totalCost = round2(register.active.reduce((s, a) => s + a.cost, 0));
  const totalAccDep = round2(register.active.reduce((s, a) => s + a.accumulated_depreciation, 0));
  const totalNBV = round2(register.active.reduce((s, a) => s + a.net_book_value, 0));

  console.log(JSON.stringify({
    as_of: asOf.slice(0, 10),
    category: categoryFilter ?? "all",
    useful_life_months_default: defaultLife,
    active: {
      count: register.active.length,
      total_cost: totalCost,
      accumulated_depreciation: totalAccDep,
      net_book_value: totalNBV,
      assets: register.active,
    },
    disposed: {
      count: register.disposed.length,
      assets: register.disposed,
    },
    written_off: {
      count: register.written_off.length,
      assets: register.written_off,
    },
  }, null, 2));
}
