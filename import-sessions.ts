import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ImportSessionSummary = {
  import_session: string;
  created_at: string;
  status: string;
  workflow_state: string;
  reporting_mode?: string;
  classification_basis?: string;
  workflow_acknowledged?: boolean;
  issue_count?: number;
  path: string;
};

export function sessionsDirFor(booksDir: string | null, anchorPath?: string): string {
  return booksDir
    ? resolve(booksDir, "imports", "sessions")
    : resolve(anchorPath ? dirname(resolve(anchorPath)) : ".", "clawbooks-import-sessions");
}

export function listImportSessions(booksDir: string | null, anchorPath?: string): ImportSessionSummary[] {
  const dir = sessionsDirFor(booksDir, anchorPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(dir, name))
    .map((path) => {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf-8")) as Omit<ImportSessionSummary, "path">;
        return { ...parsed, path };
      } catch {
        return null;
      }
    })
    .filter((value): value is ImportSessionSummary => Boolean(value))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function latestImportSession(booksDir: string | null, anchorPath?: string): ImportSessionSummary | null {
  const sessions = listImportSessions(booksDir, anchorPath);
  return sessions.at(-1) ?? null;
}
