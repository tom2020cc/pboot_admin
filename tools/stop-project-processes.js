const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const runtimeFiles = [
  path.join(packageRoot, "tools", "seo_publish_tool", ".runtime.json"),
  path.join(packageRoot, "tools", "ftp_publish_tool", ".runtime.json"),
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_error) {
    return null;
  }
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function stopTree(pid, label) {
  if (!isRunning(pid)) return false;
  console.log(`Stopping ${label} PID ${pid}...`);
  try {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "inherit",
    });
    return true;
  } catch (_error) {
    return false;
  }
}

let stopped = 0;
for (const runtimeFile of runtimeFiles) {
  const runtime = readJson(runtimeFile);
  if (!runtime || path.resolve(runtime.projectRoot || "") !== packageRoot) {
    continue;
  }

  const label = `${runtime.tool || "tool"} on port ${runtime.actualPort || "unknown"}`;
  if (stopTree(Number(runtime.launcherPid), label)) {
    stopped += 1;
  } else if (stopTree(Number(runtime.serverPid), label)) {
    stopped += 1;
  }

  try {
    fs.unlinkSync(runtimeFile);
  } catch (_error) {
    // Nothing to clean up.
  }
}

if (!stopped) {
  console.log("No running SEO/FTP process recorded for this project.");
} else {
  console.log(`Stopped ${stopped} recorded tool process(es) for this project.`);
}
