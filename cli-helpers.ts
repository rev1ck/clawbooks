const SHORT_FLAGS: Record<string, string> = { S: "source", T: "type" };

function isValue(arg: string): boolean {
  if (arg.startsWith("--")) return false;
  if (arg.length === 2 && arg[0] === "-" && SHORT_FLAGS[arg[1]]) return false;
  return true;
}

export function flags(args: string[]): Record<string, string> {
  const f: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && isValue(args[i + 1])) {
      f[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (args[i].startsWith("--")) {
      f[args[i].slice(2)] = "true";
    } else if (args[i].length === 2 && args[i][0] === "-" && SHORT_FLAGS[args[i][1]]) {
      if (i + 1 < args.length && isValue(args[i + 1])) {
        f[SHORT_FLAGS[args[i][1]]] = args[i + 1];
        i++;
      }
    }
  }
  return f;
}

export function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (i + 1 < args.length && isValue(args[i + 1])) i++;
      continue;
    }
    if (args[i].length === 2 && args[i][0] === "-" && SHORT_FLAGS[args[i][1]]) {
      if (i + 1 < args.length && isValue(args[i + 1])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function normalizeDateBoundary(value: string, boundary: "after" | "before"): string {
  if (value.includes("T")) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return boundary === "after"
      ? `${value}-01T00:00:00.000Z`
      : `${value}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return boundary === "after"
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`;
  }
  return value;
}

function parsePeriod(period: string): { after: string; before: string } {
  if (period.includes("/")) {
    const [a, b] = period.split("/");
    return {
      after: normalizeDateBoundary(a, "after"),
      before: normalizeDateBoundary(b, "before"),
    };
  }
  return {
    after: normalizeDateBoundary(period, "after"),
    before: normalizeDateBoundary(period, "before"),
  };
}

export function periodFromArgs(args: string[]): { after?: string; before?: string } {
  const f = flags(args);
  const p = positional(args);
  let after: string | undefined = f.after ? normalizeDateBoundary(f.after, "after") : undefined;
  let before: string | undefined = f.before ? normalizeDateBoundary(f.before, "before") : undefined;
  if (p[0]) {
    const period = parsePeriod(p[0]);
    after = after ?? period.after;
    before = before ?? period.before;
  }
  return { after, before };
}
