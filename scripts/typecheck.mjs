import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webTsc = resolve(root, "web", "node_modules", "typescript", "bin", "tsc");
const serverTsc = resolve(root, "server", "node_modules", "typescript", "bin", "tsc");

function run(name, script, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\x1b[36m[typecheck]\x1b[0m ${name}`);
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: "inherit", windowsHide: true });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${name} 失败（exit ${code}）`))));
    child.on("error", reject);
  });
}

try {
  await run("server", serverTsc, ["-p", "tsconfig.json", "--noEmit"], resolve(root, "server"));
  await run("web", webTsc, ["--noEmit", "-p", "tsconfig.json"], resolve(root, "web"));
  console.log("\x1b[32m[typecheck]\x1b[0m 全部通过");
} catch (error) {
  console.error(`\x1b[31m[typecheck]\x1b[0m ${error.message}`);
  process.exit(1);
}
