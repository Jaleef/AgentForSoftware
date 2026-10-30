/**
 * 代码符号调试脚本。
 *
 * 打印代码快照中的文件、符号、路由和模型解析结果。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractSymbols } from "../parsers/code.js";
import { findRepoRoot } from "./root.js";

const root = findRepoRoot();
for (const file of [
  "examples/demo-app/backend/src/services/model.service.ts",
  "examples/demo-app/backend/src/services/user.service.ts",
  "examples/demo-app/frontend/src/pages/LoginPage.tsx",
  "examples/demo-app/frontend/src/components/Layout.tsx",
]) {
  const content = readFileSync(resolve(root, file), "utf8");
  const symbols = extractSymbols(file, content);
  console.log(`\n## ${file} (${symbols.length})`);
  for (const s of symbols) console.log(`  ${s.kind} ${s.name} @${s.line} :: ${s.signature.slice(0, 90)}`);
}
