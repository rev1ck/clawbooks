import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { packagedSkillPath } from "../books.js";
import { flags, positional } from "../cli-helpers.js";

function defaultCodexSkillsDir(): string {
  const codexHome = process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");
  return join(codexHome, "skills");
}

export function cmdSkill(args: string[]) {
  const p = positional(args);
  const f = flags(args);
  const action = p[0] ?? "path";
  const packaged = packagedSkillPath("clawbooks");
  const destBase = resolve(f.dest ?? defaultCodexSkillsDir());
  const installPath = join(destBase, "clawbooks");

  if (action === "path") {
    console.log(JSON.stringify({
      skill: "clawbooks",
      packaged_path: packaged.path,
      packaged_exists: packaged.exists,
      suggested_install_path: installPath,
      codex_home: process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    }, null, 2));
    return;
  }

  if (action !== "install") {
    console.error("Usage: clawbooks skill [path|install] [--dest DIR] [--force]");
    process.exit(1);
  }

  if (!packaged.exists) {
    console.error(`Packaged skill not found: ${packaged.path}`);
    console.error("This clawbooks package does not include the installable skill assets.");
    process.exit(1);
  }

  if (existsSync(installPath)) {
    if (f.force !== "true") {
      console.error(`Skill already exists at ${installPath}`);
      console.error("Re-run with --force to replace it.");
      process.exit(1);
    }
    rmSync(installPath, { recursive: true, force: true });
  } else {
    mkdirSync(destBase, { recursive: true });
  }

  cpSync(packaged.path, installPath, {
    recursive: true,
    force: true,
  });

  console.log(JSON.stringify({
    installed: true,
    skill: "clawbooks",
    source: packaged.path,
    destination: installPath,
    next_step: "Restart Codex to pick up the new skill.",
  }, null, 2));
}
