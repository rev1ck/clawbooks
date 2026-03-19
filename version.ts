import { readFileSync } from "node:fs";

type PackageJson = {
  name?: string;
  version?: string;
};

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as PackageJson;

export const PACKAGE_NAME = pkg.name ?? "clawbooks";
export const CLI_VERSION = pkg.version ?? "0.0.0";
