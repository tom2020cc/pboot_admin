const net = require("net");
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");

const CONFIG_PATH = path.join(__dirname, "seo.config.json");
const RUNTIME_PATH = path.join(__dirname, ".runtime.json");
const configuredPort = (() => {
  try {
    return Number(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).localPort || 5188);
  } catch (_error) {
    return 5188;
  }
})();
const BASE_PORT = Number(process.env.SEO_TOOL_PORT || configuredPort);
const MAX_PORT = BASE_PORT + 40;
const TOOL_ROOT = __dirname;

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findFreePort() {
  for (let port = BASE_PORT; port <= MAX_PORT; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found between ${BASE_PORT} and ${MAX_PORT}.`);
}

async function main() {
  const port = await findFreePort();
  const url = `http://localhost:${port}`;
  const projectRoot = path.resolve(TOOL_ROOT, "..", "..");
  console.log("============================================================");
  console.log(`SEO project : ${projectRoot}`);
  console.log(`SEO tool URL: ${url}`);
  if (port !== BASE_PORT) {
    console.log(`Port ${BASE_PORT} is in use. This project switched to ${port}.`);
  }
  console.log("============================================================");

  const child = spawn(process.execPath, ["server.js"], {
    cwd: TOOL_ROOT,
    env: { ...process.env, SEO_TOOL_PORT: String(port) },
    stdio: "inherit",
  });

  fs.writeFileSync(
    RUNTIME_PATH,
    JSON.stringify(
      {
        tool: "seo",
        projectRoot,
        configuredPort: BASE_PORT,
        actualPort: port,
        launcherPid: process.pid,
        serverPid: child.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const clearRuntime = () => {
    try {
      const runtime = JSON.parse(fs.readFileSync(RUNTIME_PATH, "utf8"));
      if (runtime.launcherPid === process.pid) fs.unlinkSync(RUNTIME_PATH);
    } catch (_error) {
      // The file may already have been removed by the project stop command.
    }
  };
  const stopChild = () => {
    if (!child.killed) child.kill();
  };
  process.once("SIGINT", stopChild);
  process.once("SIGTERM", stopChild);
  process.once("exit", clearRuntime);
  child.once("exit", (code) => {
    clearRuntime();
    process.exitCode = code ?? 0;
  });

  setTimeout(() => {
    exec(`start "" "${url}"`);
  }, 900);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exitCode = 1;
});
