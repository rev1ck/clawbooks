import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ImportSessionLifecycle =
  | "checked"
  | "appended"
  | "skipped_duplicate"
  | "reviewed_not_relevant"
  | "failed";

export type ImportSessionRecord = {
  import_session: string;
  session_schema_version: string;
  created_at: string;
  recorded_via: string;
  source_doc?: string | null;
  source_hash?: string | null;
  apparent_source_entity?: string | null;
  entity_mismatch?: boolean | null;
  lifecycle?: ImportSessionLifecycle | null;
  appended_event_count?: number | null;
  ledger_changed?: boolean | null;
  operator_identity?: string | null;
  notes?: string | null;
  mapper_path?: string | null;
  scaffold_kind?: string | null;
  input_path?: string | null;
  statement_profile_path?: string | null;
  status: string;
  workflow_state: string;
  reporting_mode?: string;
  classification_basis?: string;
  workflow_acknowledged?: boolean;
  issue_count?: number;
  path?: string;
} & Record<string, unknown>;

export type ImportSessionSummary = {
  import_session: string;
  created_at: string;
  recorded_via?: string | null;
  status: string;
  workflow_state: string;
  reporting_mode?: string;
  classification_basis?: string;
  workflow_acknowledged?: boolean;
  issue_count?: number;
  input_path?: string | null;
  statement_profile_path?: string | null;
  operator_identity?: string | null;
  source_doc?: string | null;
  source_hash?: string | null;
  apparent_source_entity?: string | null;
  entity_mismatch?: boolean | null;
  lifecycle?: ImportSessionLifecycle | null;
  appended_event_count?: number | null;
  ledger_changed?: boolean | null;
  path: string;
};

export function sessionsDirFor(booksDir: string | null, anchorPath?: string): string {
  return booksDir
    ? resolve(booksDir, "imports", "sessions")
    : resolve(anchorPath ? dirname(resolve(anchorPath)) : ".", "clawbooks-import-sessions");
}

export function sessionIndexPathFor(booksDir: string | null, anchorPath?: string): string {
  return booksDir
    ? resolve(booksDir, "imports", "session-index.json")
    : resolve(anchorPath ? dirname(resolve(anchorPath)) : ".", "clawbooks-import-session-index.json");
}

export function readImportSession(path: string): ImportSessionRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ImportSessionRecord;
  } catch {
    return null;
  }
}

export function listImportSessions(booksDir: string | null, anchorPath?: string): ImportSessionSummary[] {
  const dir = sessionsDirFor(booksDir, anchorPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(dir, name))
    .map((path) => {
      const parsed = readImportSession(path);
      return parsed ? { ...parsed, path } as ImportSessionSummary : null;
    })
    .filter((value): value is ImportSessionSummary => Boolean(value))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function latestImportSession(booksDir: string | null, anchorPath?: string): ImportSessionSummary | null {
  const sessions = listImportSessions(booksDir, anchorPath);
  return sessions.at(-1) ?? null;
}

function buildImportSessionIndexPayload(booksDir: string | null, anchorPath?: string) {
  const sessions = listImportSessions(booksDir, anchorPath).map((session) => ({
    filename: session.path.split("/").at(-1) ?? session.path,
    import_session: session.import_session,
    created_at: session.created_at,
    recorded_via: typeof session.recorded_via === "string" ? session.recorded_via : null,
    input_path: typeof session.input_path === "string" ? session.input_path : null,
    status: session.status,
    workflow_state: session.workflow_state,
    reporting_mode: session.reporting_mode ?? null,
    classification_basis: session.classification_basis ?? null,
    workflow_acknowledged: session.workflow_acknowledged ?? null,
    issue_count: session.issue_count ?? null,
    source_doc: session.source_doc ?? null,
    source_hash: session.source_hash ?? null,
    apparent_source_entity: session.apparent_source_entity ?? null,
    entity_mismatch: session.entity_mismatch ?? null,
    lifecycle: session.lifecycle ?? null,
    appended_event_count: session.appended_event_count ?? null,
    ledger_changed: session.ledger_changed ?? null,
  }));

  return {
    generated_at: new Date().toISOString(),
    session_count: sessions.length,
    sessions: sessions.slice().reverse(),
  };
}

export function rebuildImportSessionIndex(booksDir: string | null, anchorPath?: string) {
  const indexPath = sessionIndexPathFor(booksDir, anchorPath);
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(buildImportSessionIndexPayload(booksDir, anchorPath), null, 2) + "\n", "utf-8");
  return indexPath;
}

export function writeImportSessionRecord(booksDir: string | null, anchorPath: string, session: ImportSessionRecord) {
  const dir = sessionsDirFor(booksDir, anchorPath);
  mkdirSync(dir, { recursive: true });
  const sessionPath = resolve(dir, `${session.import_session}.json`);
  writeFileSync(sessionPath, JSON.stringify(session, null, 2) + "\n", "utf-8");
  rebuildImportSessionIndex(booksDir, anchorPath);
  return sessionPath;
}

export function updateImportSessionRecord(
  booksDir: string | null,
  anchorPath: string,
  sessionId: string,
  patch: Partial<ImportSessionRecord>,
) {
  const sessionPath = resolve(sessionsDirFor(booksDir, anchorPath), `${sessionId}.json`);
  if (!existsSync(sessionPath)) return null;
  const current = readImportSession(sessionPath);
  if (!current) return null;
  const next = { ...current, ...patch };
  writeFileSync(sessionPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
  rebuildImportSessionIndex(booksDir, anchorPath);
  return sessionPath;
}
