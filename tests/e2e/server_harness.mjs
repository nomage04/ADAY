import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const root = path.resolve(import.meta.dirname, "..", "..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(url, process) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`server exited with ${process.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("local server did not become ready");
}

export async function startServer() {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pptgen-e2e-"));
  const localConfig = path.join(dataDir, "config.local.js");
  const child = spawn("python", ["-m", "backend.server", "--no-open", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, PPTGEN_DATA_DIR: dataDir, PPTGEN_LOCAL_CONFIG: localConfig },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitUntilReady(`${url}/api/state`, child);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${stderr.slice(-2000)}`);
  }
  return {
    url, dataDir,
    async stop() {
      if (child.exitCode === null) child.kill();
      await new Promise(resolve => child.once("exit", resolve));
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
