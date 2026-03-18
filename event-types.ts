import type { LedgerEvent } from "./ledger.js";

export const OUTFLOW_TYPES = new Set([
  "expense", "tax_payment", "owner_draw", "fee", "dividend",
  "loan_repayment", "refund", "transfer_out", "withdrawal",
]);

export const INFLOW_TYPES = new Set([
  "income", "deposit", "equity_injection", "loan_received",
  "transfer_in", "refund_received", "grant",
]);

export const META_TYPES = new Set(["snapshot", "reclassify", "opening_balance", "correction", "confirm"]);
export const ASSET_EVENT_TYPES = new Set(["disposal", "write_off", "impairment"]);
export const TRANSFER_TYPES = new Set(["transfer_in", "transfer_out"]);
export const OPERATING_INCOME_TYPES = new Set(["income", "refund_received", "grant"]);
export const DOCUMENT_TYPES = new Set(["invoice", "bill"]);

export function classifyEventSection(event: LedgerEvent): "operating_income" | "operating_expense" | "tax" | "capex" | "owner" | "transfer" | "document" | "other" {
  if (DOCUMENT_TYPES.has(event.type)) return "document";
  if (event.type === "tax_payment") return "tax";
  if (event.type === "owner_draw") return "owner";
  if (TRANSFER_TYPES.has(event.type)) return "transfer";
  if (event.data.capitalize === true) return "capex";
  if (OPERATING_INCOME_TYPES.has(event.type)) return "operating_income";
  if (event.type === "expense" || event.type === "fee") return "operating_expense";
  return "other";
}

export function signedAmount(event: LedgerEvent): number | undefined {
  const amount = Number(event.data.amount);
  if (event.data.amount === undefined || isNaN(amount)) return undefined;
  return amount;
}

export function absAmount(event: LedgerEvent): number | undefined {
  const amount = signedAmount(event);
  if (amount === undefined) return undefined;
  return Math.abs(amount);
}

export function enforceSign(type: string, data: Record<string, unknown>): void {
  if (data.amount === undefined) return;
  const amount = Number(data.amount);
  if (isNaN(amount)) return;
  if (DOCUMENT_TYPES.has(type)) {
    if (data.direction === "issued") {
      data.amount = Math.abs(amount);
    } else if (data.direction === "received") {
      data.amount = -Math.abs(amount);
    }
    return;
  }
  if (OUTFLOW_TYPES.has(type)) {
    data.amount = -Math.abs(amount);
  } else if (INFLOW_TYPES.has(type)) {
    data.amount = Math.abs(amount);
  } else if (!META_TYPES.has(type) && !ASSET_EVENT_TYPES.has(type)) {
    console.error(`Warning: unknown type "${type}" — sign not enforced. Verify the amount sign is correct.`);
  }
}
