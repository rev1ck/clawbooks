import type { LedgerEvent } from "./ledger.js";
import { sortByTimestamp } from "./reporting.js";

export const TREATMENT_EVENT_TYPES = new Set(["treatment", "treatment_supersede"]);

export type ActiveTreatment = LedgerEvent & {
  type: "treatment";
  data: LedgerEvent["data"] & {
    treatment_id: string;
    treatment_kind: string;
    applies_to: Record<string, unknown>;
    status: string;
    effective_from?: string;
    effective_to?: string | null;
    position: Record<string, unknown>;
    compile_strategy: string;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasScopeAnchor(appliesTo: Record<string, unknown>): boolean {
  const listKeys = ["event_ids", "document_ids", "contract_ids", "account_ids"];
  for (const key of listKeys) {
    if (Array.isArray(appliesTo[key]) && appliesTo[key].length > 0) return true;
  }
  const scalarKeys = ["counterparty", "period", "entity_scope"];
  for (const key of scalarKeys) {
    const value = appliesTo[key];
    if (typeof value === "string" && value.trim()) return true;
    if (value !== null && isObject(value) && Object.keys(value).length > 0) return true;
  }
  return false;
}

function parseIsoDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Treatment field "${field}" must be YYYY-MM-DD.`);
  }
  return value;
}

function overlapDateRange(params: {
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  after?: string;
  before?: string;
}) {
  const effectiveFrom = params.effectiveFrom ?? "0000-01-01";
  const effectiveTo = params.effectiveTo ?? "9999-12-31";
  const windowAfter = params.after ? params.after.slice(0, 10) : "0000-01-01";
  const windowBefore = params.before ? params.before.slice(0, 10) : "9999-12-31";
  return effectiveFrom <= windowBefore && effectiveTo >= windowAfter;
}

function numericField(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validateTreatmentData(data: Record<string, unknown>): void {
  if (typeof data.treatment_id !== "string" || !data.treatment_id.trim()) {
    throw new Error('Treatment event requires non-empty data.treatment_id.');
  }
  if (typeof data.treatment_kind !== "string" || !data.treatment_kind.trim()) {
    throw new Error('Treatment event requires non-empty data.treatment_kind.');
  }
  if (!isObject(data.applies_to) || !hasScopeAnchor(data.applies_to)) {
    throw new Error("Treatment event data.applies_to must exist and include at least one scope anchor.");
  }
  if (typeof data.status !== "string" || !data.status.trim()) {
    throw new Error('Treatment event requires non-empty data.status.');
  }
  if (!isObject(data.position)) {
    throw new Error("Treatment event requires object data.position.");
  }
  if (typeof data.justification_summary !== "string" || !data.justification_summary.trim()) {
    throw new Error('Treatment event requires non-empty data.justification_summary.');
  }
  if (typeof data.confidence !== "string" || !data.confidence.trim()) {
    throw new Error('Treatment event requires non-empty data.confidence.');
  }
  if (typeof data.compile_strategy !== "string" || !data.compile_strategy.trim()) {
    throw new Error('Treatment event requires non-empty data.compile_strategy.');
  }

  const effectiveFrom = parseIsoDate(data.effective_from, "effective_from");
  const effectiveTo = parseIsoDate(data.effective_to, "effective_to");
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    throw new Error("Treatment effective_from must be on or before effective_to.");
  }

  const kind = String(data.treatment_kind);
  const position = data.position;
  if (kind === "capitalize_asset") {
    const usefulLife = numericField(position.useful_life_months);
    if (usefulLife === null || usefulLife <= 0) {
      throw new Error("capitalize_asset treatment requires position.useful_life_months > 0.");
    }
  }
  if (kind === "lease") {
    const termStart = parseIsoDate(position.term_start, "position.term_start");
    const termEnd = parseIsoDate(position.term_end, "position.term_end");
    if (!termStart || !termEnd) {
      throw new Error("lease treatment requires position.term_start and position.term_end.");
    }
    if (termStart > termEnd) {
      throw new Error("lease treatment term_start must be on or before term_end.");
    }
  }
  if (kind === "prepayment") {
    const coverageStart = parseIsoDate(position.coverage_start, "position.coverage_start");
    const coverageEnd = parseIsoDate(position.coverage_end, "position.coverage_end");
    if (!coverageStart || !coverageEnd) {
      throw new Error("prepayment treatment requires position.coverage_start and position.coverage_end.");
    }
  }
  if (kind === "deferred_revenue") {
    const serviceStart = parseIsoDate(position.service_period_start, "position.service_period_start");
    const serviceEnd = parseIsoDate(position.service_period_end, "position.service_period_end");
    if (!serviceStart || !serviceEnd) {
      throw new Error("deferred_revenue treatment requires position.service_period_start and position.service_period_end.");
    }
  }
  if (kind === "accrual") {
    const side = typeof position.side === "string" ? position.side : null;
    const periodStart = parseIsoDate(position.recognition_period_start, "position.recognition_period_start");
    const periodEnd = parseIsoDate(position.recognition_period_end, "position.recognition_period_end");
    if (!side || !["expense", "revenue"].includes(side)) {
      throw new Error('accrual treatment requires position.side of "expense" or "revenue".');
    }
    if (!periodStart || !periodEnd) {
      throw new Error("accrual treatment requires recognition_period_start and recognition_period_end.");
    }
  }
}

export function validateTreatmentSupersedeData(data: Record<string, unknown>): void {
  const required = ["supersede_id", "prior_treatment_id", "replacement_treatment_id", "reason", "confidence"] as const;
  for (const field of required) {
    if (typeof data[field] !== "string" || !String(data[field]).trim()) {
      throw new Error(`treatment_supersede event requires non-empty data.${field}.`);
    }
  }
}

export function validateSpecialEventPayload(type: string, data: Record<string, unknown>): void {
  if (type === "treatment") validateTreatmentData(data);
  if (type === "treatment_supersede") validateTreatmentSupersedeData(data);
}

export function loadActiveTreatments(all: LedgerEvent[], opts?: {
  after?: string;
  before?: string;
}): ActiveTreatment[] {
  const superseded = new Set(
    all
      .filter((event) => event.type === "treatment_supersede" && typeof event.data.prior_treatment_id === "string")
      .map((event) => String(event.data.prior_treatment_id)),
  );

  return sortByTimestamp(all)
    .filter((event): event is ActiveTreatment => event.type === "treatment")
    .filter((event) => String(event.data.status ?? "") === "active")
    .filter((event) => !superseded.has(String(event.data.treatment_id ?? "")))
    .filter((event) => overlapDateRange({
      effectiveFrom: typeof event.data.effective_from === "string" ? event.data.effective_from : null,
      effectiveTo: typeof event.data.effective_to === "string" ? event.data.effective_to : null,
      after: opts?.after,
      before: opts?.before,
    }));
}

export function summarizeTreatments(treatments: ActiveTreatment[]) {
  const byKind: Record<string, number> = {};
  for (const treatment of treatments) {
    const kind = String(treatment.data.treatment_kind ?? "unknown");
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return {
    active_count: treatments.length,
    by_kind: Object.fromEntries(Object.entries(byKind).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
  };
}

function eventIdsFor(treatment: ActiveTreatment): string[] {
  return Array.isArray(treatment.data.applies_to?.event_ids)
    ? treatment.data.applies_to.event_ids.map((value) => String(value))
    : [];
}

function latestByTs(treatments: ActiveTreatment[]) {
  return [...treatments].sort((left, right) =>
    left.ts.localeCompare(right.ts)
    || String(left.id).localeCompare(String(right.id))
  ).at(-1) ?? null;
}

export function applyEventLevelTreatments(events: LedgerEvent[], treatments: ActiveTreatment[]): LedgerEvent[] {
  const byEventId: Record<string, ActiveTreatment[]> = {};
  for (const treatment of treatments) {
    for (const eventId of eventIdsFor(treatment)) {
      if (!byEventId[eventId]) byEventId[eventId] = [];
      byEventId[eventId].push(treatment);
    }
  }

  return events.map((event) => {
    const scoped = byEventId[event.id] ?? [];
    if (scoped.length === 0) return event;

    const capitalize = latestByTs(scoped.filter((treatment) => treatment.data.treatment_kind === "capitalize_asset"));
    const classification = latestByTs(scoped.filter((treatment) => treatment.data.treatment_kind === "classification_override"));
    const ownerBoundary = latestByTs(scoped.filter((treatment) => treatment.data.treatment_kind === "owner_boundary"));

    let next: LedgerEvent = {
      ...event,
      data: { ...event.data },
    };

    if (capitalize) {
      const position = isObject(capitalize.data.position) ? capitalize.data.position : {};
      next.data.capitalized_via_treatment = true;
      next.data.capitalization_treatment_id = String(capitalize.data.treatment_id);
      if (numericField(position.useful_life_months) !== null) {
        next.data.useful_life_months = numericField(position.useful_life_months);
      }
      if (typeof position.asset_class === "string" && position.asset_class.trim()) {
        next.data.asset_class = position.asset_class;
      }
    }

    if (classification) {
      const position = isObject(classification.data.position) ? classification.data.position : {};
      if (typeof position.to_category === "string" && position.to_category.trim()) {
        next.data.category = position.to_category;
      }
      if (typeof position.to_type === "string" && position.to_type.trim()) {
        next = { ...next, type: position.to_type };
      }
      next.data.treatment_id = String(classification.data.treatment_id);
      next.data.treatment_kind = "classification_override";
    }

    if (ownerBoundary) {
      const position = isObject(ownerBoundary.data.position) ? ownerBoundary.data.position : {};
      if (typeof position.boundary_decision === "string" && position.boundary_decision.trim()) {
        next.data.owner_boundary_decision = position.boundary_decision;
      }
      next.data.owner_boundary_treatment_id = String(ownerBoundary.data.treatment_id);
    }

    return next;
  });
}

function treatmentPeriodOverlaps(params: {
  start?: string | null;
  end?: string | null;
  after?: string;
  before?: string;
}) {
  return overlapDateRange({
    effectiveFrom: params.start,
    effectiveTo: params.end,
    after: params.after,
    before: params.before,
  });
}

export function compileTreatmentEntries(params: {
  treatments: ActiveTreatment[];
  effectiveEvents: LedgerEvent[];
  allEffectiveEvents: LedgerEvent[];
  after?: string;
  before?: string;
}): LedgerEvent[] {
  const eventIndex = Object.fromEntries(params.allEffectiveEvents.map((event) => [event.id, event]));
  const entries: LedgerEvent[] = [];

  for (const treatment of params.treatments) {
    if (String(treatment.data.treatment_kind) !== "accrual") continue;
    const position = isObject(treatment.data.position) ? treatment.data.position : {};
    const periodStart = typeof position.recognition_period_start === "string" ? position.recognition_period_start : null;
    const periodEnd = typeof position.recognition_period_end === "string" ? position.recognition_period_end : null;
    if (!treatmentPeriodOverlaps({ start: periodStart, end: periodEnd, after: params.after, before: params.before })) continue;

    const anchorIds = eventIdsFor(treatment);
    const anchors = anchorIds.map((id) => eventIndex[id]).filter((event): event is LedgerEvent => Boolean(event));
    const firstAnchor = anchors[0];
    const amountMode = isObject(position.amount_basis) && typeof position.amount_basis.mode === "string"
      ? position.amount_basis.mode
      : null;
    const estimatedAmount = numericField(position.estimated_amount);
    const fixedAmount = numericField(position.fixed_amount);
    const sourceAmount = firstAnchor ? Math.abs(Number(firstAnchor.data.amount)) : null;
    const amountBasis = amountMode === "source_amount" ? sourceAmount : (fixedAmount ?? estimatedAmount ?? sourceAmount);
    if (amountBasis === null || amountBasis === 0) continue;

    const side = String(position.side ?? "");
    const amount = side === "revenue" ? Math.abs(amountBasis) : -Math.abs(amountBasis);
    const tsDate = (periodEnd ?? treatment.data.effective_from ?? treatment.ts.slice(0, 10)) || treatment.ts.slice(0, 10);
    const ts = `${tsDate}T00:00:00.000Z`;
    const category = typeof firstAnchor?.data.category === "string" && firstAnchor.data.category.trim()
      ? String(firstAnchor.data.category)
      : `${side === "revenue" ? "accrued_revenue" : "accrued_expense"}`;
    const currency = typeof firstAnchor?.data.currency === "string" && firstAnchor.data.currency.trim()
      ? String(firstAnchor.data.currency)
      : String(treatment.data.currency ?? "UNKNOWN");
    const type = side === "revenue" ? "income" : "expense";

    entries.push({
      ts,
      source: "clawbooks:treatment-compile",
      type,
      data: {
        amount,
        currency,
        category,
        description: String(treatment.data.justification_summary ?? `${side} accrual`),
        confidence: String(treatment.data.confidence ?? "inferred"),
        treatment_id: String(treatment.data.treatment_id),
        treatment_kind: "accrual",
        derived: true,
        compile_strategy: String(treatment.data.compile_strategy ?? "accrual_rollforward"),
      },
      id: `compiled_${String(treatment.data.treatment_id)}`,
      prev: "derived",
    });
  }

  return sortByTimestamp(entries);
}
