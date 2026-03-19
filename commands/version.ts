import { execFileSync } from "node:child_process";
import { CLI_VERSION, PACKAGE_NAME } from "../version.js";

export function cmdVersion(args: string[]) {
  if (!args.includes("--latest")) {
    console.log(CLI_VERSION);
    return;
  }

  try {
    const latest = execFileSync("npm", ["view", PACKAGE_NAME, "version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    console.log(JSON.stringify({
      package: PACKAGE_NAME,
      current: CLI_VERSION,
      latest,
      update_available: latest !== CLI_VERSION,
    }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({
      package: PACKAGE_NAME,
      current: CLI_VERSION,
      latest: null,
      update_available: null,
      error: String((err as Error).message),
    }, null, 2));
    process.exit(1);
  }
}
