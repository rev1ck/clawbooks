import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const outDir = resolve(root, ".dist/scoped-cli");
const packageJsonPath = resolve(root, "package.json");

const runPack = process.argv.includes("--pack");
const dryRun = process.argv.includes("--dry-run");

const basePkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

if (!existsSync(resolve(root, "build/cli.js")) || !existsSync(resolve(root, "build/ledger.js"))) {
  console.error("Build output is missing. Run `npm run build` first.");
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const rel of [
  "build",
  "README.md",
  "LICENSE",
  "program.md",
  "policy.md.example",
  "policy-simple.md.example",
  "policy-complex.md.example",
]) {
  cpSync(resolve(root, rel), resolve(outDir, rel), { recursive: true });
}

const {
  scripts: _scripts,
  devDependencies: _devDependencies,
  ...publishablePkg
} = basePkg;

const scopedPkg = {
  ...publishablePkg,
  name: "@clawbooks/cli",
  publishConfig: {
    ...(basePkg.publishConfig ?? {}),
    access: "public",
  },
};

writeFileSync(resolve(outDir, "package.json"), `${JSON.stringify(scopedPkg, null, 2)}\n`, "utf-8");

console.log(`Prepared scoped package at ${outDir}`);

if (runPack) {
  const result = spawnSync(
    "npm",
    dryRun ? ["pack", "--dry-run"] : ["pack"],
    {
      cwd: outDir,
      stdio: "inherit",
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? "/tmp/.npm-cache",
      },
    },
  );

  process.exit(result.status ?? 1);
}
