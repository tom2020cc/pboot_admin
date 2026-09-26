// 宝塔面板 API 客户端：登录 + 计划任务（用于「远程构建并重启」）
// 登录协议：username = RSA(md5(md5(user + 登录token)))，password = RSA(md5(md5(pass) + "_bt.cn"))
// token 与 RSA 公钥从入口页 HTML 提取；面板 AJAX 需 x-http-token（主页 request_token，每次加载轮换）。
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { resolveLocalAddress } = require("./ftp-client");

function createBtPanel(panelConfig) {
  const { url } = panelConfig;
  const parsed = new URL(url);
  const clientLib = parsed.protocol === "https:" ? https : http;
  const entrance = parsed.pathname.replace(/\/+$/, "") || "/";

  function request(method, pathAndQuery, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? Buffer.from(body) : null;
      const req = clientLib.request(
        {
          hostname: parsed.hostname,
          localAddress: resolveLocalAddress(panelConfig),
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          method,
          path: pathAndQuery,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36",
            ...(data
              ? {
                  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                  "Content-Length": data.length,
                  "X-Requested-With": "XMLHttpRequest",
                }
              : {}),
            ...headers,
          },
          timeout: 25000,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("面板请求超时")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  const md5 = (t) => crypto.createHash("md5").update(t, "utf8").digest("hex");

  function rsaEncrypt(publicKeyPem, text) {
    const normalized = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, "-----BEGIN PUBLIC KEY-----\n")
      .replace(/-----END PUBLIC KEY-----/, "\n-----END PUBLIC KEY-----\n");
    const key = crypto.createPublicKey(normalized);
    return crypto
      .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text, "utf8"))
      .toString("base64");
  }

  function parseCookies(res, jar) {
    for (const raw of [].concat(res.headers["set-cookie"] || [])) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }

  const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

  async function login() {
    const entry = await request("GET", entrance);
    const jar = {};
    parseCookies(entry, jar);
    const token = (entry.body.match(/vite_public_login_token\s*=\s*"([^"]+)"/) || [])[1];
    const pub = (entry.body.match(/vite_public_encryption\s*=\s*"([^"]+)"/) || [])[1];
    if (!token || !pub) throw new Error("无法从面板入口页解析登录 token/公钥");
    const body = new URLSearchParams({
      username: rsaEncrypt(pub, md5(md5(panelConfig.user + token))),
      password: rsaEncrypt(pub, md5(md5(panelConfig.password) + "_bt.cn")),
    }).toString();
    const res = await request("POST", "/login", body, {
      Cookie: cookieHeader(jar),
      Referer: url,
    });
    parseCookies(res, jar);
    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch (_error) {
      throw new Error("面板登录响应异常（非 JSON）");
    }
    if (!parsed.status) throw new Error(`面板登录失败：${parsed.msg || "未知错误"}`);
    return jar;
  }

  async function refreshToken(jar) {
    const main = await request("GET", "/", null, { Cookie: cookieHeader(jar), Referer: url });
    parseCookies(main, jar);
    const match = main.body.match(/request_token="([^"]+)"/);
    if (!match) throw new Error("面板主页未找到 request_token（会话可能失效）");
    return match[1];
  }

  let session;
  async function call(method, pathAndQuery, formBody) {
    const jar = session || (session = await login());
    let requestToken = await refreshToken(jar);
    let res = await request(method, pathAndQuery, formBody || "", {
      Cookie: cookieHeader(jar),
      Referer: url,
      "x-http-token": requestToken,
    });
    if (res.status !== 200 || /权限认证失败/.test(res.body) || /^\s*</.test(res.body)) {
      requestToken = await refreshToken(jar);
      res = await request(method, pathAndQuery, formBody || "", {
        Cookie: cookieHeader(jar),
        Referer: url,
        "x-http-token": requestToken,
      });
    }
    return res;
  }

  return { login, call };
}

// Automatic and manual publishing share one fixed entrypoint.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function buildRemoteApplyScript({ serverRoot = "/www/wwwroot/pboot_admin_center" } = {}) {
  if (!serverRoot.startsWith("/") || serverRoot.split("/").includes("..")) throw new Error("服务器项目目录必须是绝对路径");
  return `bash ${shellQuote(serverRoot.replace(/\/$/, "") + "/deploy/apply-project.sh")}`;
}
function responseJson(res) {
  if (res.status !== 200) throw new Error(`宝塔响应 HTTP ${res.status}`);
  try { return JSON.parse(res.body); } catch (_) { throw new Error("宝塔返回了无效响应，请检查登录状态"); }
}
async function runRemoteBuild(panel, serverRoot, { onLog = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 200, command } = {}) {
  const taskName = `pboot_build_${crypto.randomBytes(12).toString('hex')}`;
  const script = `#!/bin/bash\nmkdir /tmp/${taskName} 2>/dev/null || exit 0\n${command || buildRemoteApplyScript({ serverRoot })} || { echo PBOOT_BUILD_FAILED; exit 1; }`;
  const call = async (action, data) => responseJson(await panel.call('POST', `/crontab?action=${action}`, new URLSearchParams(data).toString()));
  const created = await call('AddCrontab', { name: taskName, type: 'day', where1: '', hour: '0', minute: '0', week: '', sType: 'toShell', sName: '', sBody: script, urladdress: '', backupTo: 'localhost', save: '3' });
  if (!created.status) throw new Error(`创建构建任务失败：${created.msg || '未知错误'}`);
  let id = created.id || created.data?.id;
  if (!id) {
    const listed = await call('GetCrontab', { search: taskName });
    const rows = Array.isArray(listed) ? listed : listed.data;
    id = rows?.find(row => row.name === taskName)?.id;
  }
  if (!id) throw new Error(`未找到构建任务 ${taskName}，请在宝塔计划任务中核对`);
  let buildLog = '';
  try {
    const started = await call('StartTask', { id });
    if (!started.status) throw new Error(`启动构建失败：${started.msg || '未知错误'}`);
    for (let i = 0; i < attempts; i++) {
      await sleep(3000);
      const logs = await call('GetLogs', { id });
      const text = typeof logs === 'string' ? logs : (logs.msg || logs.data || '');
      if (typeof text !== 'string') throw new Error('无法读取构建日志');
      if (text !== buildLog) { onLog(text.slice(-6000)); buildLog = text; }
      if (/^PBOOT_BUILD_FAILED[^\r\n]*/m.test(text)) throw new Error(`线上构建失败：${text.slice(-2000)}`);
      if (/^PBOOT_BUILD_DONE\s*$/m.test(text)) return { log: text };
    }
    throw new Error('等待构建超时，未确认上线。请在宝塔检查构建日志后重试。');
  } finally {
    try {
      const deleted = await call('DelCrontab', { id });
      if (!deleted.status) throw new Error(deleted.msg);
    } catch (error) { onLog(`临时构建任务 ${taskName} 未清理：${error.message}`); }
  }
}
module.exports = { createBtPanel, buildRemoteApplyScript, runRemoteBuild, shellQuote };
