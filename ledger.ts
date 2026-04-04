import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";

export interface LedgerEvent {
  ts: string;
  source: string;
  type: string;
  data: Record<string, unknown>;
  id: string;
  prev: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function computeId(
  data: Record<string, unknown>,
  meta: { source: string; type: string; ts: string },
): string {
  const envelope = {
    data: stableValue(data),
    source: meta.source,
    ts: meta.ts,
    type: meta.type,
  };
  const canonical = JSON.stringify(envelope);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function readAll(path: string): LedgerEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function filter(
  events: LedgerEvent[],
  opts?: { after?: string; before?: string; source?: string; type?: string; last?: number }
): LedgerEvent[] {
  let out = events;
  if (opts?.after) out = out.filter((e) => e.ts >= opts.after!);
  if (opts?.before) out = out.filter((e) => e.ts <= opts.before!);
  if (opts?.source) out = out.filter((e) => e.source === opts.source);
  if (opts?.type) out = out.filter((e) => e.type === opts.type);
  if (opts?.last) out = out.slice(-opts.last);
  return out;
}

export function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex").slice(0, 16);
}

const CURRENCY_EXEMPT_TYPES = new Set([
  "snapshot",
  "reclassify",
  "opening_balance",
  "correction",
  "confirm",
  "treatment",
  "treatment_supersede",
]);

export function append(path: string, event: LedgerEvent): boolean {
  if (!CURRENCY_EXEMPT_TYPES.has(event.type) && event.data.currency === undefined) {
    throw new Error(`Event missing data.currency (type: ${event.type}, id: ${event.id})`);
  }
  if (!existsSync(path)) writeFileSync(path, "", "utf-8");
  const existing = readAll(path);
  if (existing.some((e) => e.id === event.id)) return false;

  // Compute prev hash from last line in file
  if (existing.length === 0) {
    event.prev = "genesis";
  } else {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    event.prev = hashLine(lines[lines.length - 1]);
  }

  appendFileSync(path, JSON.stringify(event) + "\n", "utf-8");
  return true;
}

export function rewrite(path: string, events: LedgerEvent[]): void {
  let prev = "genesis";
  const lines: string[] = [];
  for (const e of events) {
    e.prev = prev;
    const line = JSON.stringify(e);
    prev = hashLine(line);
    lines.push(line);
  }
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
}

export function latestSnapshot(events: LedgerEvent[], before?: string): LedgerEvent | null {
  let snapshots = events.filter((e) => e.type === "snapshot");
  if (before) snapshots = snapshots.filter((e) => e.ts <= before);
  return snapshots.at(-1) ?? null;
}
