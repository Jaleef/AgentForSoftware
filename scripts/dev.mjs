import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(root, "server", "node_modules", "tsx", "dist", "cli.mjs");
const viteCli = resolve(root, "web", "node_modules", "vite", "bin", "vite.js");

const children = [];
let shuttingDown = false;

function launch(name, args, cwd, color) {
  const child = spawn(process.execPath, args, {
    cwd,
    // Development mode makes the server load the repository-root .env file.
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);

  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const write = (stream, chunk) => {
    const lines = chunk.toString().split(/\r?\n/).filter((line) => line.length > 0);
    for (const line of lines) stream.write(`${prefix}${line}\n`);
  };
  child.stdout.on("data", (chunk) => write(process.stdout, chunk));
  child.stderr.on("data", (chunk) => write(process.stderr, chunk));
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`${prefix}进程退出（code=${code ?? "null"}, signal=${signal ?? "null"}），正在停止其他进程…`);
      shutdown(code === 0 ? 0 : 1);
    }
  });
  child.on("error", (error) => {
    console.error(`${prefix}启动失败：${error.message}`);
    shutdown(1);
  });
}

function terminate(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      // Kill the full process tree; tsx/vite spawn child processes.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) terminate(child);
  setTimeout(() => process.exit(exitCode), 700).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function portFree(port) {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once("error", () => resolveFree(false));
    server.once("listening", () => server.close(() => resolveFree(true)));
    server.listen(port, "127.0.0.1");
  });
}

for (const [name, port] of [
  ["后端", 8787],
  ["前端", 5173],
]) {
  if (!(await portFree(port))) {
    console.error(
      `\x1b[31m[dev]\x1b[0m ${name}端口 ${port} 已被占用。请先停止占用进程，或设置 PORT/HOST 后单独启动。`,
    );
    process.exit(1);
  }
}

console.log(`\x1b[36m[dev]\x1b[0m server http://127.0.0.1:8787  ·  web http://127.0.0.1:5173`);
launch("server", [tsxCli, "watch", "src/index.ts"], resolve(root, "server"), "34");
launch("web", [viteCli], resolve(root, "web"), "32");
