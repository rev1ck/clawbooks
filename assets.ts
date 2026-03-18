import type { LedgerEvent } from "./ledger.js";
import { round2 } from "./reporting.js";

export interface AssetBaseRecord {
  id: string;
  date: string;
  description: string;
  category: string;
  cost: number;
  currency: string;
  useful_life_months: number;
  monthly_depreciation: number;
  months_elapsed: number;
  accumulated_depreciation: number;
  impairment_total: number;
  net_book_value: number;
  fully_depreciated: boolean;
}

export interface DisposedAssetRecord extends AssetBaseRecord {
  proceeds: number;
  gain_loss: number;
}

export interface WrittenOffAssetRecord extends AssetBaseRecord {
  loss: number;
}

export interface AssetRegister {
  active: AssetBaseRecord[];
  disposed: DisposedAssetRecord[];
  written_off: WrittenOffAssetRecord[];
}

export function buildAssetRegister(
  events: LedgerEvent[],
  options?: {
    category?: string;
    defaultLife?: number;
    asOf?: string;
  },
): AssetRegister {
  const categoryFilter = options?.category;
  const defaultLife = options?.defaultLife ?? 36;
  const asOf = options?.asOf ?? new Date().toISOString();

  const disposals: Record<string, LedgerEvent> = {};
  const writeOffs: Record<string, LedgerEvent> = {};
  const impairments: Record<string, LedgerEvent[]> = {};

  for (const e of events) {
    const assetId = String(e.data.asset_id ?? "");
    if (!assetId) continue;
    if (e.type === "disposal") disposals[assetId] = e;
    else if (e.type === "write_off") writeOffs[assetId] = e;
    else if (e.type === "impairment") {
      if (!impairments[assetId]) impairments[assetId] = [];
      impairments[assetId].push(e);
    }
  }

  const active: AssetBaseRecord[] = [];
  const disposed: DisposedAssetRecord[] = [];
  const writtenOff: WrittenOffAssetRecord[] = [];

  for (const e of events) {
    if (e.data.capitalize !== true) continue;
    const cat = String(e.data.category ?? "");
    if (categoryFilter && cat !== categoryFilter) continue;

    const amount = Math.abs(Number(e.data.amount));
    if (isNaN(amount)) continue;

    const currency = String(e.data.currency ?? "UNKNOWN");
    const description = String(e.data.description ?? "");
    const lifeMonths = Number(e.data.useful_life_months) || defaultLife;

    const purchaseDate = new Date(e.ts);
    const reportDate = new Date(asOf);
    const monthsElapsed = Math.max(0,
      (reportDate.getFullYear() - purchaseDate.getFullYear()) * 12 +
      (reportDate.getMonth() - purchaseDate.getMonth()),
    );
    const monthlyDep = round2(amount / lifeMonths);
    const accDep = round2(Math.min(amount, monthlyDep * monthsElapsed));

    let impairmentTotal = 0;
    if (impairments[e.id]) {
      for (const imp of impairments[e.id]) {
        impairmentTotal = round2(impairmentTotal + Math.abs(Number(imp.data.impairment_amount) || 0));
      }
    }

    const nbv = round2(Math.max(0, amount - accDep - impairmentTotal));

    const record: AssetBaseRecord = {
      id: e.id,
      date: e.ts.slice(0, 10),
      description,
      category: cat,
      cost: amount,
      currency,
      useful_life_months: lifeMonths,
      monthly_depreciation: monthlyDep,
      months_elapsed: Math.min(monthsElapsed, lifeMonths),
      accumulated_depreciation: accDep,
      impairment_total: impairmentTotal,
      net_book_value: nbv,
      fully_depreciated: monthsElapsed >= lifeMonths,
    };

    if (disposals[e.id]) {
      const proceeds = Number(disposals[e.id].data.proceeds) || 0;
      disposed.push({ ...record, net_book_value: 0, proceeds, gain_loss: round2(proceeds - nbv) });
    } else if (writeOffs[e.id]) {
      writtenOff.push({ ...record, net_book_value: 0, loss: round2(-nbv) });
    } else {
      active.push(record);
    }
  }

  return {
    active,
    disposed,
    written_off: writtenOff,
  };
}
