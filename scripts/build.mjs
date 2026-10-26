import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webTsc = resolve(root, "web", "node_modules", "typescript", "bin", "tsc");
const serverTsc = resolve(root, "server", "node_modules", "typescript", "bin", "tsc");
const viteCli = resolve(root, "web", "node_modules", "vite", "bin", "vite.js");

function run(name, script, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\x1b[36m[build]\x1b[0m ${name}: ${args.join(" ")}`);
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${name} 失败（exit ${code}）`));
    });
    child.on("error", reject);
  });
}

try {
  await run("web tsc", webTsc, ["--noEmit", "-p", "tsconfig.json"], resolve(root, "web"));
  await run("web vite", viteCli, ["build"], resolve(root, "web"));
  await run("server tsc", serverTsc, ["-p", "tsconfig.json"], resolve(root, "server"));
  console.log("\x1b[32m[build]\x1b[0m 构建完成：web/dist + server/dist");
} catch (error) {
  console.error(`\x1b[31m[build]\x1b[0m ${error.message}`);
  process.exit(1);
}
