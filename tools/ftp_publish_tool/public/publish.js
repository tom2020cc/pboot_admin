(function () {
  const { $, api, escapeHtml, formatBytes, postJson, renderNavigation, setStatus } = window.FtpTool;
  let uploadPollTimer = null;
  let busyPollTimer = null;
  let uploadRunning = false;
  let securityRunning = false;

  function setResult(kind, title, message) {
    $("resultBanner").className = `result-banner ${kind || ""}`.trim();
    $("resultTitle").textContent = title;
    $("resultMessage").textContent = message;
  }

  function setActionState() {
    const blocked = uploadRunning || securityRunning;
    ["saveBtn", "testBtn", "uploadBtn"].forEach((id) => { $(id).disabled = blocked; });
    if (securityRunning && !uploadRunning) setStatus("安全巡检正在运行，发布操作暂时停用");
  }

  function formData() {
    return {
      host: $("host").value,
      port: Number($("port").value || 21),
      user: $("user").value,
      password: $("password").value,
      remoteRoot: $("remoteRoot").value || "/",
      secure: $("secure").value === "true",
      uploadScope: $("uploadScope").value,
      uploadMode: $("uploadMode").value,
      recentImageDays: Number($("recentImageDays").value || 14),
      uploadDatabase: $("uploadDatabase").checked,
      uploadImages: $("uploadImages").checked,
      skipSameSizeAssets: $("skipSameSizeAssets").checked,
      backupBeforeOverwrite: $("backupBeforeOverwrite").checked,
      backupMaxFileSizeMb: Number($("backupMaxFileSizeMb").value || 20),
    };
  }

  async function persistForm() {
    await postJson("/api/config", formData());
    $("password").value = "";
  }

  function updateScopeNote() {
    const scope = $("uploadScope").value;
    const locked = scope === "seo" || scope === "full";
    $("uploadMode").disabled = locked;
    $("recentImageDays").disabled = locked;
    $("uploadDatabase").disabled = locked;
    $("uploadImages").disabled = locked;
    $("skipSameSizeAssets").disabled = scope === "seo";
    $("modeNote").textContent = scope === "seo"
      ? "只发布 sitemap、robots、IndexNow key 和搜索引擎验证文件。"
      : scope === "full"
        ? "代码与文本文件始终覆盖；图片、视频和字体等二进制文件同大小时跳过。"
        : "快速模式只选择数据库、SEO 文件和最近改动图片；完整模式检查全部图片。";
  }

  async function loadConfig() {
    const result = await api("/api/config");
    const config = result.config || {};
    renderNavigation(result.navigation, "ftp");
    $("host").value = config.host || "";
    $("port").value = config.port || 21;
    $("user").value = config.user || "";
    $("password").placeholder = config.passwordSet ? "已保存，留空不修改" : "请输入 FTP 密码";
    $("remoteRoot").value = config.remoteRoot || "/";
    $("secure").value = String(Boolean(config.secure));
    $("uploadScope").value = config.uploadScope || "site";
    $("uploadMode").value = config.uploadMode || "quick";
    $("recentImageDays").value = config.recentImageDays || 14;
    $("uploadDatabase").checked = config.uploadDatabase !== false;
    $("uploadImages").checked = config.uploadImages !== false;
    $("skipSameSizeAssets").checked = config.skipSameSizeAssets !== false;
    $("backupBeforeOverwrite").checked = config.backupBeforeOverwrite !== false;
    $("backupMaxFileSizeMb").value = config.backupMaxFileSizeMb || 20;
    updateScopeNote();
  }

  async function saveConfig() {
    setStatus("正在保存配置");
    await persistForm();
    await refreshPlan();
    setStatus("FTP 配置已保存");
  }

  async function refreshPlan() {
    const plan = await api("/api/plan");
    $("fileCount").textContent = plan.total;
    $("totalSize").textContent = plan.totalSizeText;
    const modeText = plan.uploadScope === "seo"
      ? "仅 SEO 收录文件"
      : plan.uploadScope === "full"
        ? "整站发布，代码覆盖、同大小二进制跳过"
        : plan.uploadMode === "full" ? "完整检查全部图片" : `仅选择最近 ${plan.recentImageDays} 天图片`;
    $("planMeta").textContent = `${plan.total} 个文件，远端目录 ${plan.remoteRoot || "/"}，${modeText}。`;
    $("groups").innerHTML = plan.groups.length
      ? plan.groups.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.count}</td><td>${escapeHtml(item.sizeText)}</td></tr>`).join("")
      : `<tr><td colspan="3"><div class="empty">当前范围没有待发布文件</div></td></tr>`;
    $("files").innerHTML = plan.files.length
      ? plan.files.map((item) => `<tr><td class="path-cell">${escapeHtml(item.relativePath)}</td><td>${escapeHtml(item.sizeText)}</td></tr>`).join("")
      : `<tr><td colspan="2"><div class="empty">暂无文件</div></td></tr>`;
  }

  function itemType(type) {
    if (type === 2 || type === "directory") return "目录";
    if (type === 1 || type === "file") return "文件";
    return String(type || "-");
  }

  function renderRemotePreview(result) {
    $("remotePreview").style.display = "block";
    $("loginDir").textContent = `登录目录：${result.loginDir || "-"}`;
    $("currentDir").textContent = `当前目录：${result.currentDir || "-"}`;
    const items = result.items || [];
    const names = items.map((item) => String(item.name || "").toLowerCase());
    const looksLikeRoot = names.includes("data") && (names.includes("static") || names.includes("template") || names.includes("apps"));
    $("remoteHint").className = looksLikeRoot ? "subtitle ok-text" : "subtitle warn-text";
    $("remoteHint").textContent = looksLikeRoot ? "当前目录看起来是 PbootCMS 网站根目录。" : "当前目录不像网站根目录，请核对 wwwroot、public_html 或 htdocs 等目录。";
    $("remoteItems").innerHTML = items.length
      ? items.map((item) => `<tr><td class="path-cell">${escapeHtml(item.name)}</td><td>${escapeHtml(itemType(item.type))}</td><td>${escapeHtml(formatBytes(item.size))}</td></tr>`).join("")
      : `<tr><td colspan="3"><div class="empty">目录为空或服务端不允许列目录</div></td></tr>`;
  }

  async function testConnection() {
    setStatus("正在测试 FTP 连接");
    $("connectionBadge").className = "status-badge running";
    $("connectionBadge").textContent = "连接中";
    await persistForm();
    const result = await api("/api/test", { method: "POST" });
    renderRemotePreview(result);
    $("connectionBadge").className = "status-badge safe";
    $("connectionBadge").textContent = "连接正常";
    setStatus("FTP 连接正常");
  }

  async function startUpload() {
    const scope = $("uploadScope").value;
    const backup = $("backupBeforeOverwrite").checked;
    const scopeText = scope === "seo" ? "SEO 收录文件" : scope === "full" ? "整站文件" : "网站数据与图片";
    if (!confirm(`确定发布${scopeText}吗？${backup ? "远端同名文件会先下载到本机备份。" : "当前未启用覆盖前备份。"}`)) return;
    setResult("running", "发布准备中", "正在连接 FTP 并核对远端文件。");
    setStatus("正在启动 FTP 发布");
    await persistForm();
    await postJson("/api/upload", { scope });
    await refreshUploadStatus();
    scheduleUploadPoll(900);
  }

  async function refreshUploadStatus() {
    const state = await api("/api/upload/status");
    uploadRunning = Boolean(state.running);
    $("uploaded").textContent = state.uploaded || 0;
    $("skipped").textContent = state.skipped || 0;
    $("backedUp").textContent = state.backedUp || 0;
    $("logs").textContent = (state.logs || []).join("\n") || "等待操作。";
    $("logs").scrollTop = $("logs").scrollHeight;
    $("backupPath").textContent = state.backupRoot ? `本机备份：${state.backupRoot}` : "尚无覆盖备份。";
    if (state.error) {
      setStatus(`发布失败：${state.error}`, true);
      setResult("fail", "发布失败", `已上传 ${state.uploaded} 个，跳过 ${state.skipped} 个，备份 ${state.backedUp || 0} 个。${state.error}`);
    } else if (state.running) {
      const done = Number(state.uploaded || 0) + Number(state.skipped || 0);
      setStatus(`发布中 ${done}/${state.total}`);
      setResult("running", `发布中 ${done}/${state.total}`, state.current ? `当前文件：${state.current}` : "正在处理远端文件。");
    } else if (state.finishedAt) {
      setStatus("FTP 发布完成");
      setResult("success", "发布完成", `上传 ${state.uploaded} 个，跳过 ${state.skipped} 个，覆盖前备份 ${state.backedUp || 0} 个。`);
    }
    setActionState();
    return state;
  }

  function scheduleUploadPoll(delay) {
    if (uploadPollTimer) clearTimeout(uploadPollTimer);
    uploadPollTimer = setTimeout(async () => {
      try {
        const state = await refreshUploadStatus();
        if (state.running) scheduleUploadPoll(1200);
      } catch (error) { setStatus(error.message, true); }
    }, delay);
  }

  async function refreshSecurityBusy() {
    const state = await api("/api/security/status");
    securityRunning = Boolean(state.running);
    setActionState();
  }

  function scheduleBusyPoll() {
    if (busyPollTimer) clearTimeout(busyPollTimer);
    busyPollTimer = setTimeout(async () => {
      try { await refreshSecurityBusy(); } catch (_error) { /* keep publishing page usable */ }
      scheduleBusyPoll();
    }, securityRunning ? 1600 : 8000);
  }

  $("saveBtn").onclick = () => saveConfig().catch((error) => setStatus(error.message, true));
  $("planBtn").onclick = () => refreshPlan().then(() => setStatus("上传计划已刷新")).catch((error) => setStatus(error.message, true));
  $("testBtn").onclick = () => testConnection().catch((error) => {
    $("connectionBadge").className = "status-badge danger";
    $("connectionBadge").textContent = "连接失败";
    setStatus(error.message, true);
  });
  $("uploadBtn").onclick = () => startUpload().catch((error) => setStatus(error.message, true));
  $("uploadScope").onchange = updateScopeNote;

  Promise.all([loadConfig(), refreshPlan(), refreshUploadStatus(), refreshSecurityBusy()])
    .then(() => {
      if (!uploadRunning && !securityRunning) setStatus("就绪");
      if (uploadRunning) scheduleUploadPoll(900);
      scheduleBusyPoll();
    })
    .catch((error) => setStatus(error.message, true));
}());
