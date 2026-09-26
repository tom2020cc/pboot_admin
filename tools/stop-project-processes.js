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

// 防御性孤儿清扫：凡 node.exe 命令行引用本项目根路径的进程（前端 vite、工具绝对路径等），
// 且未被上面的 runtime.json 记录覆盖，一并停掉。后端相对路径 dist/main 由 project-port.ps1 按端口/身份处理，
// 工具相对路径 launch.js/server.js 由上面的 runtime.json 记录处理，这里只兜底绝对路径引用。
try {
  const psRoot = packageRoot.replace(/'/g, "''");
  const ps = [
    `$root = '${psRoot}'`,
    `$pids = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -ExpandProperty ProcessId)`,
    `$pids | ForEach-Object { $_.ToString() }`,
  ].join("; ");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", ps],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  const orphanPids = output.split(/\s+/).filter((s) => /^\d+$/.test(s)).map(Number);
  for (const pid of orphanPids) {
    if (pid === process.pid) continue;
    if (stopTree(pid, `orphan node (project path)`)) stopped += 1;
  }
} catch (_error) {
  // 清扫失败不影响已记录的停止结果。
}

if (!stopped) {
  console.log("No running SEO/FTP process recorded for this project.");
} else {
  console.log(`Stopped ${stopped} recorded tool process(es) for this project.`);
}
