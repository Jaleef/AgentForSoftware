import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve repository root whether the tool is started from root or from server/. */
export function findRepoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "文档例子")) || existsSync(resolve(cwd, "pnpm-workspace.yaml"))) return cwd;
  const parent = resolve(cwd, "..");
  if (existsSync(resolve(parent, "文档例子")) || existsSync(resolve(parent, "pnpm-workspace.yaml"))) return parent;
  return cwd;
}
