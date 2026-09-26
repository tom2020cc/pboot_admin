(function () {
  const { $, api, escapeAttr, escapeHtml, formatBytes, formatDate, postJson, renderNavigation, setStatus } = window.FtpTool;
  let pollTimer = null;
  let config = null; // {project, sites} — 密码已脱敏
  let sites = [];    // {code, name, rootPath, isDefault}
  let sections = [];
  let syncRunning = false;

  function setResult(kind, title, message) {
    $("resultBanner").className = `result-banner ${kind || ""}`.trim();
    $("resultTitle").textContent = title;
    $("resultMessage").textContent = message;
  }

  function setControlsDisabled(disabled) {
    document.querySelectorAll("main button, main input, main select").forEach((control) => { control.disabled = disabled; });
  }

  function targetOptions() {
    return `<option value="project">${escapeHtml(config.project.name || "宝塔管理项目")}</option>`;
  }

  function selectedTargetKey() {
    return $("targetSelect").value || "project";
  }

  function currentTarget() {
    const key = selectedTargetKey();
    return key === "project" ? config.project : config.sites[key.slice("site:".length)];
  }

  function fillTargetForm() {
    const target = currentTarget();
    if (!target) return;
    $("host").value = target.host || "";
    $("port").value = target.port || 21;
    $("user").value = target.user || "";
    $("password").value = "";
    $("password").placeholder = target.passwordSet ? "已保存，留空不修改" : "请输入 FTP 密码";
    $("remoteRoot").value = target.remoteRoot || "/";
    $("secure").value = String(target.secure !== false);
    if (target.networkInterface && ![...$('networkInterface').options].some(item => item.value === target.networkInterface)) $('networkInterface').add(new Option(`${target.networkInterface}（当前不可用）`, target.networkInterface));
    $('networkInterface').value = target.networkInterface || '';
    $("serverRoot").value = target.serverProjectRoot || target.serverSiteRoot || "";
    $("targetEnabled").checked = target.enabled !== false;

    // 宝塔面板配置（仅管理项目显示）
    const isProject = selectedTargetKey() === "project";
    $("btPanelSection").style.display = isProject ? "block" : "none";
    if (isProject && target.btPanel) {
      $("btPanelUrl").value = target.btPanel.url || "";
      $("btPanelUser").value = target.btPanel.user || "";
      $("btPanelPassword").value = "";
      $("btPanelPassword").placeholder = target.btPanel.passwordSet ? "已保存，留空不修改" : "请输入宝塔面板密码";
      $("btPanelAutoBuild").checked = target.btPanel.autoBuild || false;
      $("projectRunBtn").textContent = target.btPanel.autoBuild ? '同步代码并上线' : '上传代码';
    }
  }

  function renderSiteChecks() {
    $("siteChecks").innerHTML = sites.length
      ? sites.map((site) => `<label class="check"><input type="checkbox" class="site-check" value="${escapeAttr(site.code)}" ${site.isDefault ? "checked" : ""} />${escapeHtml(site.name || site.code)}</label>`).join("")
      : `<span class="hint">还没有受管站点，请先在管理后台添加。</span>`;
    $("sectionChecks").innerHTML = sections.filter(section => !["siteFile", "state"].includes(section.id)).map((section) => (
      `<label class="check"><input type="checkbox" class="section-check" value="${escapeAttr(section.id)}" />${escapeHtml(section.label)}</label>`
    )).join("");
  }

  async function saveTarget() {
    const key = selectedTargetKey();
    const input = {
      host: $("host").value,
      port: Number($("port").value || 21),
      user: $("user").value,
      remoteRoot: $("remoteRoot").value || "/",
      secure: $("secure").value === "true",
      networkInterface: $('networkInterface').value,
      enabled: $("targetEnabled").checked,
      password: $("password").value,
    };
    const body = {};
    if (key === "project") {
      body.project = {
        ...input,
        serverProjectRoot: $("serverRoot").value,
        btPanel: {
          url: $("btPanelUrl").value,
          user: $("btPanelUser").value,
          password: $("btPanelPassword").value,
          autoBuild: $("btPanelAutoBuild").checked,
        },
      };
    } else {
      body.sites = { [key.slice("site:".length)]: { ...input, serverSiteRoot: $("serverRoot").value } };
    }
    setStatus("正在保存同步目标");
    const result = await postJson("/api/sync/config", body);
    config = result.config;
    $("password").value = "";
    fillTargetForm();
    setStatus("同步目标已保存");
  }

  async function testTarget() {
    const key = selectedTargetKey();
    $("targetBadge").className = "status-badge running";
    $("targetBadge").textContent = "连接中";
    setStatus("正在测试 FTP 连接");
    const result = await postJson("/api/sync/test", key === "project"
      ? { targetType: "project" }
      : { targetType: "site", siteCode: key.slice("site:".length) });
    const hint = key === "project"
      ? (result.looksLikeProjectRoot ? "远端目录看起来是管理项目根目录。" : "远端目录没看到 package.json / backend / frontend，请核对项目根路径。")
      : (result.looksLikePbootRoot ? "远端目录看起来是 PbootCMS 网站根目录。" : "远端目录不像 PbootCMS 根目录，请核对站点目录。");
    $("targetBadge").className = "status-badge safe";
    $("targetBadge").textContent = "连接正常";
    $("targetHint").textContent = `${hint}（当前目录 ${result.currentDir || "-"}）`;
    setStatus("FTP 连接正常");
  }

  function renderPlanTable(tbodyId, plan) {
    const tbody = $(tbodyId);
    tbody.innerHTML = plan.files && plan.files.length
      ? plan.files.map((file) => (
        `<tr><td class="path-cell">${escapeHtml(file.relativePath)}</td>`
        + (plan.preset === "site-data" ? "" : `<td>${file.action === "new" ? "新增" : "修改"}</td>`)
        + `<td>${escapeHtml(file.sizeText || formatBytes(file.size))}</td></tr>`
      )).join("")
      : `<tr><td colspan="3"><div class="empty">没有待上传文件（内容与上次同步一致）</div></td></tr>`;
  }

  function renderDiffMetrics(prefix, plan) {
    $(`${prefix}Fresh`).textContent = plan.counts.fresh ?? "-";
    $(`${prefix}Changed`).textContent = plan.counts.changed ?? "-";
    $(`${prefix}Unchanged`).textContent = plan.counts.unchanged ?? "-";
    $(`${prefix}Removed`).textContent = plan.counts.removedSinceLastSync ?? "-";
    $(`${prefix}Size`).textContent = plan.toUploadSizeText || "-";
  }

  function renderWarnings(containerId, plan) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = (plan.warnings || []).map((warning) => `<div class="warn-box">${escapeHtml(warning)}</div>`).join("");
  }

  function renderNotes(noteId, plan) {
    const notes = [...(plan.notes || [])];
    if (plan.truncated) notes.push("文件较多，仅显示前 300 个待上传文件。");
    if (plan.counts.removedSinceLastSync > 0) notes.push(`本地已删 ${plan.counts.removedSinceLastSync} 个文件仅在远端存在，本功能不会删除远端文件。`);
    $(noteId).textContent = notes.join(" ");
  }

  function renderChecklist(containerId, checklist) {
    const container = $(containerId);
    if (!container) return;
    if (!checklist) { container.style.display = "none"; return; }
    container.style.display = "block";
    container.innerHTML = `<strong>${escapeHtml(checklist.title)}</strong><ol>${(checklist.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`
      + (checklist.code ? `<pre>${escapeHtml(checklist.code)}</pre>` : "");
  }

  function managedOptions() {
    return {
      sites: Array.from(document.querySelectorAll(".site-check:checked")).map((input) => input.value),
      sections: Array.from(document.querySelectorAll(".section-check:checked")).map((input) => input.value),
      backendUploads: false,
      aiKeys: false,
      backupBeforeOverwrite: $("managedBackup").checked,
    };
  }

  function projectConfigOptions() {
    return { backendUploads: $("backendUploads").checked, aiKeys: $("aiKeys").checked, searchAccounts: $("searchAccounts").checked, backupBeforeOverwrite: false };
  }

  async function refreshPlan(preset) {
    setStatus("正在生成同步计划");
    const body = { preset, options: {} };
    if (preset === "project-code") {
      body.options = { forceFull: $("projectForceFull").checked, backupBeforeOverwrite: $("projectBackup").checked };
    } else if (preset === "project-config") {
      body.options = projectConfigOptions();
    } else if (preset === "managed-sites") {
      body.options = managedOptions();
    }
    const { plan } = await postJson("/api/sync/plan", body);
    if (!plan.ready) throw new Error("同步目标缺少 FTP 地址、用户名或密码，请先在上方填写并保存。");
    if (preset === "project-code") {
      renderDiffMetrics("project", plan);
      renderPlanTable("projectFiles", plan);
      renderNotes("projectNote", plan);
      $("projectLastSync").textContent = plan.lastSyncAt ? `上次上传 ${formatDate(plan.lastSyncAt)}` : "未同步";
      $("projectLastSync").className = plan.lastSyncAt ? "status-badge safe" : "status-badge";
    } else if (preset === "managed-sites") {
      renderDiffMetrics("managed", plan);
      renderPlanTable("managedFiles", plan);
      renderWarnings("managedWarnings", plan);
      renderNotes("managedNote", plan);
      $("managedLastSync").textContent = plan.lastSyncAt ? `上次上传 ${formatDate(plan.lastSyncAt)}` : "未同步";
      $("managedLastSync").className = plan.lastSyncAt ? "status-badge safe" : "status-badge";
      const mappings = plan.pathMappings || [];
      $("mappingWrap").style.display = mappings.length ? "block" : "none";
      $("mappingRows").innerHTML = mappings.map((mapping) => (
        `<tr><td class="path-cell">${escapeHtml(mapping.from)}</td><td class="path-cell">${escapeHtml(mapping.to)}</td></tr>`
      )).join("");
    } else if (preset === "project-config") {
      renderPlanTable("projectConfigFiles", plan);
      renderWarnings("projectConfigWarnings", plan);
      renderNotes("projectConfigNote", plan);
      $("projectConfigLastSync").textContent = plan.lastSyncAt ? `上次上传 ${formatDate(plan.lastSyncAt)}` : "未同步";
    } else if (preset === "database") {
      $("databaseLocal").textContent = `本地库：${plan.localPath}（${plan.toUploadSizeText}）→ 暂存为 ${plan.remoteName} + 同名 .json 校验单`;
    }
    setStatus("计划已刷新");
    return plan;
  }

  async function runSync(preset, extraConfirm = null) {
    if (extraConfirm && !extraConfirm()) return;
    const plan = await refreshPlan(preset);
    if (!["database", "project-code"].includes(preset) && plan.toUploadCount === 0) {
      setStatus("没有需要上传的文件");
      setResult("success", "无需同步", "内容与上次同步一致，没有待上传文件。");
      return;
    }
    setResult("running", "同步准备中", "正在连接宝塔 FTP。");
    setStatus("正在启动同步");
    const body = { preset, confirm: true, options: {} };
    if (preset === "project-code") {
      body.options = { forceFull: $("projectForceFull").checked, backupBeforeOverwrite: $("projectBackup").checked };
    } else if (preset === "project-config") {
      body.options = projectConfigOptions();
    } else if (preset === "managed-sites") {
      body.options = managedOptions();
    }
    await postJson("/api/sync/run", body);
    await refreshStatus();
    schedulePoll(900);
  }

  const checklistByPreset = {
    "project-code": "projectChecklist",
    "managed-sites": "managedChecklist",
    "project-config": "projectConfigChecklist",
    database: "databaseChecklist",
  };

  async function refreshStatus() {
    const state = await api("/api/sync/status");
    syncRunning = Boolean(state.running);
    setControlsDisabled(syncRunning);
    $("logs").textContent = (state.logs || []).join("\n") || "等待操作。";
    $("logs").scrollTop = $("logs").scrollHeight;
    $("backupPath").textContent = state.backupRoot ? `本机备份：${state.backupRoot}` : "尚无覆盖备份。";
    if (state.error) {
      setStatus(`同步失败：${state.error}`, true);
      setResult("fail", "同步失败", `已上传 ${state.uploaded || 0} 项。${state.error}`);
    } else if (state.running && state.phase === "building") {
      setStatus("线上构建中");
      setResult("running", "代码已上传，正在构建上线", "正在构建并重启服务，请等待健康检查通过。日志会持续更新。");
    } else if (state.running) {
      const done = Number(state.uploaded || 0) + Number(state.skipped || 0);
      setStatus(`同步中 ${done}/${state.total || "?"}`);
      setResult("running", `同步中 ${done}/${state.total || "?"}`, state.current ? `当前文件：${state.current}` : "正在处理远端文件。");
    } else if (state.finishedAt) {
      const pending = state.phase === 'awaiting-build';
      const title = pending ? '代码已上传，等待上线' : state.preset === 'project-code' ? '已上线' : '配置已上传';
      setStatus(title);
      setResult(pending ? 'running' : 'success', title, pending ? '在下方执行一条上线命令，或开启自动上线后重试。' : `上传 ${state.uploaded || 0} 项。${state.preset === 'project-code' ? '构建、重启和健康检查已通过，请刷新线上后台。' : '请查看对应配置的生效说明。'}`);
      const containerId = checklistByPreset[state.preset];
      if (containerId) renderChecklist(containerId, state.checklist);
    }
    return state;
  }

  function schedulePoll(delay) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const state = await refreshStatus();
        if (state.running) schedulePoll(1200);
        else await refreshHistory();
      } catch (error) { setStatus(error.message, true); }
    }, delay);
  }

  async function refreshHistory() {
    const { history } = await api("/api/sync/history");
    $("historyList").innerHTML = history && history.length
      ? history.map((item) => (
        `<div class="history-item"><strong>${escapeHtml(item.preset)} · ${formatDate(item.finishedAt || item.startedAt)}</strong>`
        + `<span>上传 ${item.uploaded || 0}，跳过 ${item.skipped || 0}，备份 ${item.backedUp || 0}${item.error ? `，失败：${escapeHtml(item.error)}` : ""}</span></div>`
      )).join("")
      : `<div class="empty">暂无记录</div>`;
  }

  async function loadConfig() {
    const result = await api("/api/sync/config");
    const networks = await api('/api/ftp/network');
    for (const item of networks.interfaces || []) $('networkInterface').add(new Option(`${item.name} (${item.address})`, item.name));
    config = result.config;
    sites = result.sites || [];
    sections = result.sections || [];
    renderNavigation(result.navigation, "ftp");
    $("targetSelect").innerHTML = targetOptions();
    fillTargetForm();
    renderSiteChecks();
    const environment = await api("/deployment-environment");
    if (environment.environment !== "local") {
      document.querySelectorAll('main > section:not(#envGuard), main > details').forEach(element => { element.hidden = true; });
      $("envGuard").style.display = "block";
      $("envGuardText").textContent = `当前环境为「${environment.label}」。同步功能只在本地环境（backend/.env 设置 APP_ENVIRONMENT=local）开放。`;
      setControlsDisabled(true);
      setStatus("仅本地环境可用");
      return false;
    }
    return true;
  }

  $("targetSelect").onchange = fillTargetForm;
  $("targetSaveBtn").onclick = () => saveTarget().catch((error) => setStatus(error.message, true));
  $("targetTestBtn").onclick = () => testTarget().catch((error) => {
    $("targetBadge").className = "status-badge danger";
    $("targetBadge").textContent = "连接失败";
    setStatus(error.message, true);
  });
  $("projectPlanBtn").onclick = () => refreshPlan("project-code").catch((error) => setStatus(error.message, true));
  $("projectRunBtn").onclick = () => runSync("project-code").catch((error) => setStatus(error.message, true));
  $("projectConfigPlanBtn").onclick = () => refreshPlan("project-config").catch(error => setStatus(error.message, true));
  $("projectConfigRunBtn").onclick = () => runSync("project-config").catch(error => setStatus(error.message, true));
  $("managedPlanBtn").onclick = () => refreshPlan("managed-sites").catch((error) => setStatus(error.message, true));
  $("managedRunBtn").onclick = () => runSync("managed-sites").catch((error) => setStatus(error.message, true));

  loadConfig()
    .then(async (ready) => {
      if (!ready) return;
      await Promise.all([refreshStatus(), refreshHistory()]);
      if (!syncRunning) setStatus("就绪");
      if (syncRunning) schedulePoll(900);
    })
    .catch((error) => setStatus(error.message, true));
}());
