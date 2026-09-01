(function () {
  const { $, api, escapeAttr, escapeHtml, formatDate, postJson, renderNavigation, setStatus } = window.FtpTool;
  const categoryLabels = {
    "dangerous-path": "伪装脚本",
    "executable-in-upload": "上传目录脚本",
    "content-signature": "高风险代码",
    "new-file": "新增文件",
    "modified-file": "基线变化",
    "missing-file": "文件消失",
    "local-mismatch": "线上本地不一致",
    "remote-only-code": "线上独有脚本",
    "timestamp-anomaly": "时间异常",
    "metadata-change": "元数据变化",
  };
  let configReady = false;
  let securityRunning = false;
  let uploadRunning = false;
  let allFindings = [];
  let pollTimer = null;

  function severityLabel(value) {
    return value === "high" ? "高风险" : value === "medium" ? "需关注" : "记录";
  }

  function setItem(id, good, title, detail) {
    const node = $(id);
    node.className = `posture-item ${good ? "good" : "attention"}`;
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  }

  function updatePosture(state) {
    const baseline = state.baseline || {};
    const monitor = state.monitor || {};
    const values = [configReady, Boolean(monitor.backupBeforeOverwrite), Boolean(baseline.exists), Boolean(monitor.enabled)];
    const score = values.filter(Boolean).length;
    $("postureSummary").textContent = score === 4 ? "防护已完整启用" : `已启用 ${score} / 4 项`;
    setItem("postureConfig", configReady, configReady ? "FTP 配置已就绪" : "FTP 配置不完整", configReady ? (monitor.secureFtp ? "使用 FTPS 加密连接" : "当前使用普通 FTP") : "请先到发布页保存连接信息");
    setItem("postureBackup", monitor.backupBeforeOverwrite, monitor.backupBeforeOverwrite ? "覆盖前备份已启用" : "覆盖前备份未启用", monitor.backupBeforeOverwrite ? "发布可保留恢复副本" : "请到发布页启用");
    setItem("postureBaseline", baseline.exists, baseline.exists ? "可信基线已建立" : "尚无可信基线", baseline.exists ? `${baseline.files || 0} 个文件，${baseline.hashedFiles || 0} 个内容哈希，${formatDate(baseline.createdAt)}` : "首次完整巡检后可直接采用结果");
    setItem("postureMonitor", monitor.enabled, monitor.enabled ? "定时巡检已启用" : "定时巡检未启用", monitor.enabled ? `每 ${monitor.intervalMinutes} 分钟检查` : "只能依靠手动扫描");
  }

  function updateActionState() {
    const blocked = securityRunning || uploadRunning || !configReady;
    ["scanBtn", "fullScanBtn", "baselineBtn", "adoptBaselineBtn", "forceBaselineBtn", "hardeningBtn"].forEach((id) => { $(id).disabled = blocked; });
    $("cancelScanBtn").disabled = !securityRunning;
    $("monitorSaveBtn").disabled = securityRunning || uploadRunning;
    if (uploadRunning && !securityRunning) setStatus("FTP 发布正在运行，安全操作暂时停用");
  }

  function renderFindings() {
    const severity = $("severityFilter").value;
    const category = $("categoryFilter").value;
    const query = $("findingSearch").value.trim().toLowerCase();
    const filtered = allFindings.filter((item) => {
      if (severity !== "all" && item.severity !== severity) return false;
      if (category !== "all" && item.category !== category) return false;
      return !query || `${item.path} ${item.title} ${item.detail}`.toLowerCase().includes(query);
    });
    $("findings").innerHTML = filtered.length
      ? filtered.map((item) => `<tr>
          <td><span class="severity ${escapeAttr(item.severity)}">${escapeHtml(severityLabel(item.severity))}</span></td>
          <td class="path-cell">${escapeHtml(item.path)}</td>
          <td>${escapeHtml(item.title)}<div class="subtitle">${escapeHtml(categoryLabels[item.category] || item.category)}</div></td>
          <td>${escapeHtml(item.detail || "-")}</td>
          <td><button class="small evidence-btn" data-path="${escapeAttr(item.path)}">下载留证</button></td>
        </tr>`).join("")
      : `<tr><td colspan="5"><div class="empty">${allFindings.length ? "当前筛选条件下没有结果" : "本次未发现异常或尚未扫描"}</div></td></tr>`;
  }

  function renderHistory(history) {
    $("scanHistory").innerHTML = history && history.length
      ? history.map((item) => {
          const summary = item.summary || {};
          const legacy = Number(item.scannerVersion || 0) < 2;
          const scanLabel = item.scanType === "incremental" ? "增量快检" : "完整复核";
          return `<div class="history-item"><strong>${escapeHtml(formatDate(item.finishedAt))} · ${scanLabel}${legacy ? " · 旧规则" : ""}</strong><span>文件 ${summary.files || 0}，深查 ${summary.contentScanned || 0}，跳过 ${summary.skippedUnchanged || 0}，高风险 ${summary.high || 0}，新增 ${summary.newFiles || 0}，变化 ${summary.modifiedFiles || 0}${legacy ? "（仅供参考）" : ""}</span></div>`;
        }).join("")
      : `<div class="empty">暂无历史记录</div>`;
  }

  function renderSecurityState(state) {
    securityRunning = Boolean(state.running);
    updatePosture(state);
    $("monitorEnabled").checked = Boolean(state.monitor?.enabled);
    $("monitorInterval").value = state.monitor?.intervalMinutes || 360;
    $("monitorFullDays").value = state.monitor?.fullScanIntervalDays || 7;
    const result = state.result;
    const summary = result?.summary || {};
    $("securityFiles").textContent = result ? summary.files || 0 : "-";
    $("securityHigh").textContent = summary.high || 0;
    $("securityMedium").textContent = summary.medium || 0;
    $("securityNew").textContent = summary.newFiles || 0;
    $("securityModified").textContent = summary.modifiedFiles || 0;
    $("securitySkipped").textContent = summary.skippedUnchanged || 0;
    $("securityLogs").textContent = (state.logs || []).join("\n") || "等待操作。";
    $("securityLogs").scrollTop = $("securityLogs").scrollHeight;
    renderHistory(state.history || []);

    const current = Number(state.current || 0);
    const total = Number(state.total || 0);
    const listing = state.running && state.stage === "listing";
    const reconnecting = state.running && state.stage === "reconnecting";
    const percent = listing ? 8 : total ? Math.min(100, Math.round(current / total * 100)) : state.running ? 4 : result ? 100 : 0;
    $("securityProgressBar").style.width = `${percent}%`;
    $("securityProgressCount").textContent = listing
      ? `已发现 ${current} 个文件`
      : !total && current
        ? `已读取 ${current} 个文件后中断`
        : `${current} / ${total}`;
    $("securityProgressText").textContent = state.running
      ? reconnecting
        ? `FTP 连接中断，正在自动重连：${state.currentPath || "当前操作"}`
        : listing
          ? "正在遍历远端目录"
          : `正在检查文件：${state.currentPath || ""}`
      : state.error
        ? `扫描失败：${state.error}`
        : result
          ? `${result.scanType === "incremental" ? "增量快检" : "完整复核"}完成：深查 ${summary.contentScanned || 0}，跳过未变化 ${summary.skippedUnchanged || 0}`
          : "等待扫描";

    const badge = $("securityBadge");
    if (state.running) {
      badge.className = "status-badge running";
      badge.textContent = "扫描中";
      setStatus("远程安全巡检正在运行");
    } else if (state.error) {
      badge.className = "status-badge danger";
      badge.textContent = "扫描失败";
      setStatus(`巡检失败：${state.error}`, true);
    } else if (result && summary.high > 0) {
      badge.className = "status-badge danger";
      badge.textContent = `${summary.high} 项高风险`;
      setStatus("扫描完成，请核对高风险文件");
    } else if (result && summary.medium > 0) {
      badge.className = "status-badge warn";
      badge.textContent = `${summary.medium} 项需关注`;
      setStatus("扫描完成，有文件需要核对");
    } else if (result) {
      badge.className = "status-badge safe";
      badge.textContent = "未发现高风险";
      setStatus("扫描完成");
    } else {
      badge.className = "status-badge";
      badge.textContent = "尚未扫描";
      setStatus("就绪");
    }

    allFindings = result?.findings || [];
    const categories = [...new Set(allFindings.map((item) => item.category))];
    const selected = $("categoryFilter").value;
    $("categoryFilter").innerHTML = `<option value="all">全部类型</option>${categories.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(categoryLabels[value] || value)}</option>`).join("")}`;
    if (categories.includes(selected)) $("categoryFilter").value = selected;
    renderFindings();
    $("scanWarnings").innerHTML = (result?.warnings || []).map((warning) => `<div class="warning-row">${escapeHtml(warning)}</div>`).join("");
    $("forceBaselineBtn").hidden = !state.baselineBlocked;
    $("adoptBaselineBtn").hidden = !state.canAdoptBaseline;
    $("scanBtn").textContent = state.baseline?.exists ? "增量快检（推荐）" : "首次完整巡检";
    $("baselineBtn").textContent = state.baseline?.exists ? "重新建立可信基线" : "完整扫描并建立基线";
    updateActionState();
  }

  async function loadShell() {
    const result = await api("/api/config");
    configReady = Boolean(result.config?.host && result.config?.user && result.config?.passwordSet);
    renderNavigation(result.navigation, "ftp-security");
  }

  async function refreshSecurityStatus() {
    const state = await api("/api/security/status");
    renderSecurityState(state);
    return state;
  }

  async function refreshUploadBusy() {
    const state = await api("/api/upload/status");
    uploadRunning = Boolean(state.running);
    updateActionState();
  }

  function schedulePoll(delay = 1000) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const [state] = await Promise.all([refreshSecurityStatus(), refreshUploadBusy()]);
        schedulePoll(state.running ? 1200 : 9000);
      } catch (error) {
        setStatus(error.message, true);
        schedulePoll(12000);
      }
    }, delay);
  }

  async function startScan(mode, allowFindings = false, scanType = "incremental") {
    if (mode === "baseline") {
      const question = allowFindings
        ? "扫描发现了高风险项。仍设为可信基线会把当前状态视为正常，确定继续吗？"
        : "请只在确认当前网站干净且功能正常时建立可信基线。现在开始完整扫描吗？";
      if (!confirm(question)) return;
    }
    await postJson(mode === "baseline" ? "/api/security/baseline" : "/api/security/scan", { allowFindings, scanType });
    await refreshSecurityStatus();
    schedulePoll(900);
  }

  async function saveMonitor() {
    await postJson("/api/security/monitor", {
      enabled: $("monitorEnabled").checked,
      intervalMinutes: Number($("monitorInterval").value || 360),
      fullScanIntervalDays: Number($("monitorFullDays").value || 7),
    });
    setStatus("定时巡检设置已保存");
    await refreshSecurityStatus();
  }

  async function cancelScan() {
    await postJson("/api/security/cancel");
    setStatus("正在取消安全巡检");
    await refreshSecurityStatus();
    schedulePoll(700);
  }

  async function adoptBaseline() {
    if (!confirm("把最近一次完整且无高风险的巡检结果设为可信基线吗？以后增量快检会跳过未变化文件。")) return;
    await postJson("/api/security/baseline/adopt", {});
    setStatus("可信基线已建立，后续默认使用增量快检");
    await refreshSecurityStatus();
  }

  async function captureEvidence(remotePath) {
    if (!confirm(`下载远端文件到本机留证目录吗？\n${remotePath}`)) return;
    setStatus("正在下载异常文件留证");
    const result = await postJson("/api/security/evidence", { path: remotePath });
    setStatus(`留证已保存：${result.evidence.localPath}`);
  }

  async function createHardening() {
    if (!confirm("将在本地上传/静态目录生成 Apache 和 IIS 防执行规则，已有文件不会覆盖。确定继续吗？")) return;
    const result = await postJson("/api/security/hardening", { confirm: true });
    const created = result.created || [];
    $("hardeningResult").className = created.length ? "hint ok-text" : "hint warn-text";
    $("hardeningResult").textContent = created.length
      ? `已生成 ${created.length} 个规则文件：${created.join("、")}。${result.note}`
      : `没有新建文件。${result.note}`;
    setStatus(created.length ? "防执行规则已生成到本地" : "防执行规则未产生新文件");
  }

  $("scanBtn").onclick = () => startScan("scan", false, "incremental").catch((error) => setStatus(error.message, true));
  $("fullScanBtn").onclick = () => startScan("scan", false, "full").catch((error) => setStatus(error.message, true));
  $("baselineBtn").onclick = () => startScan("baseline").catch((error) => setStatus(error.message, true));
  $("adoptBaselineBtn").onclick = () => adoptBaseline().catch((error) => setStatus(error.message, true));
  $("forceBaselineBtn").onclick = () => startScan("baseline", true).catch((error) => setStatus(error.message, true));
  $("monitorSaveBtn").onclick = () => saveMonitor().catch((error) => setStatus(error.message, true));
  $("cancelScanBtn").onclick = () => cancelScan().catch((error) => setStatus(error.message, true));
  $("hardeningBtn").onclick = () => createHardening().catch((error) => setStatus(error.message, true));
  $("severityFilter").onchange = renderFindings;
  $("categoryFilter").onchange = renderFindings;
  $("findingSearch").oninput = renderFindings;
  $("findings").onclick = (event) => {
    const button = event.target.closest(".evidence-btn");
    if (button) captureEvidence(button.dataset.path).catch((error) => setStatus(error.message, true));
  };

  Promise.all([loadShell(), refreshUploadBusy()])
    .then(refreshSecurityStatus)
    .then((state) => schedulePoll(state.running ? 1200 : 9000))
    .catch((error) => setStatus(error.message, true));
}());
