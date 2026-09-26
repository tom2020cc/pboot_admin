(function () {
  const { $, api, postJson, escapeHtml, formatBytes } = window.FtpTool;
  let localPath = '', remotePath = '', siteId = 0, items = [], plan = null, busy = false, running = false;
  const selected = new Set();
  function message(text, error = false) { $('fmMessage').textContent = text; $('fmMessage').className = error ? 'warn-text' : 'subtitle'; }
  function invalidate() { plan = null; $('fmPreview').hidden = true; $('fmSelected').textContent = `已选 ${selected.size} 项`; }
  function parent(value) { return value.split('/').slice(0, -1).join('/'); }
  function date(value) { return value ? new Date(value).toLocaleString() : '-'; }
  function lock(value) {
    busy = value;
    $('fileManager').querySelectorAll('button,input').forEach(control => { control.disabled = value || control.dataset.blocked === 'true'; });
    if (!value) { $('fmLocalUp').disabled = !localPath; $('fmRemoteUp').disabled = !remotePath; }
  }
  async function action(fn) {
    if (busy) return;
    lock(true);
    try { await fn(); } catch (error) { message(error.message, true); }
    finally { if (!running) lock(false); }
  }
  async function loadLocal(next = localPath) {
    const result = await api(`/api/files/local?path=${encodeURIComponent(next)}&includeEnvironment=${$('fmEnvironment').checked}`);
    if (siteId && siteId !== result.siteId) { selected.clear(); invalidate(); }
    siteId = result.siteId; localPath = result.path; items = result.items;
    $('fmLocalRoot').textContent = result.root; $('fmLocalPath').textContent = '/' + localPath;
    $('fmSelectAll').checked = false;
    $('fmLocalItems').innerHTML = items.length ? items.map((item, index) => `<tr><td><input type="checkbox" data-select="${index}" aria-label="选择 ${escapeHtml(item.name)}" ${selected.has(item.path) ? 'checked' : ''} ${item.blocked ? 'disabled data-blocked="true"' : ''} /></td><td>${item.directory && !item.blocked ? `<button class="file-entry" data-local="${index}">📁 ${escapeHtml(item.name)}</button>` : escapeHtml(item.name)}${item.blocked ? `<small class="file-blocked">${escapeHtml(item.blocked)}</small>` : ''}</td><td>${item.directory ? '目录' : formatBytes(item.size)}</td><td>${escapeHtml(date(item.modified))}</td></tr>`).join('') : '<tr><td colspan="4">目录为空</td></tr>';
  }
  async function loadRemote(next = remotePath) {
    message('正在连接并读取远程目录，连接中断时会自动重试…');
    const result = await api(`/api/files/remote?path=${encodeURIComponent(next)}`);
    remotePath = result.path;
    $('fmRemoteRoot').textContent = result.root; $('fmRemotePath').textContent = '/' + remotePath;
    $('fmRemoteItems').innerHTML = result.items.length ? result.items.map((item, index) => `<tr><td>${item.directory && !item.blocked ? `<button class="file-entry" data-remote="${index}">📁 ${escapeHtml(item.name)}</button>` : escapeHtml(item.name)}</td><td>${item.directory ? '目录' : formatBytes(item.size)}</td><td>${escapeHtml(date(item.modified))}</td></tr>`).join('') : '<tr><td colspan="3">目录为空</td></tr>';
    $('fmRemoteItems').querySelectorAll('[data-remote]').forEach(button => { button.onclick = () => action(() => loadRemote(result.items[Number(button.dataset.remote)].path)); });
    message('远程目录已读取。上传始终按本地相对路径写入 FTP 根目录，不受右侧浏览位置影响。');
  }
  $('fmLocalItems').onclick = event => {
    const button = event.target.closest('[data-local]');
    if (button) action(() => loadLocal(items[Number(button.dataset.local)].path));
  };
  $('fmLocalItems').onchange = event => {
    const input = event.target.closest('[data-select]');
    if (!input || busy) return;
    const item = items[Number(input.dataset.select)];
    if (input.checked) selected.add(item.path); else selected.delete(item.path);
    invalidate();
  };
  $('fmSelectAll').onchange = () => {
    for (const item of items.filter(item => !item.blocked)) { if ($('fmSelectAll').checked) selected.add(item.path); else selected.delete(item.path); }
    $('fmLocalItems').querySelectorAll('[data-select]').forEach(input => { input.checked = selected.has(items[Number(input.dataset.select)].path); }); invalidate();
  };
  $('fmEnvironment').onchange = () => { selected.clear(); invalidate(); action(() => loadLocal('')); };
  $('fmRefresh').onclick = () => action(() => loadLocal());
  $('fmRemoteRefresh').onclick = () => action(() => loadRemote());
  $('fmLocalUp').onclick = () => action(() => loadLocal(parent(localPath)));
  $('fmRemoteUp').onclick = () => action(() => loadRemote(parent(remotePath)));
  $('fmClear').onclick = () => { selected.clear(); invalidate(); action(() => loadLocal()); };
  $('fmDismiss').onclick = invalidate;
  // Existing connection controls must be saved before creating a new plan.
  ['host', 'port', 'user', 'password', 'remoteRoot', 'secure', 'networkInterface'].forEach(id => $(id).addEventListener('input', invalidate));
  async function previewSelection() {
    invalidate();
    const next = await postJson('/api/files/plan', { siteId, paths: [...selected], includeEnvironment: $('fmEnvironment').checked });
    if (next.files.some(file => file.relativePath.startsWith('template/')) && next.templateDependencyVersion !== 1) {
      throw new Error('本地发布服务仍是旧版本，请重启网站发布工具后再预览模板同步。尚未上传任何文件。');
    }
    plan = next;
    $('fmPlanSummary').textContent = `${plan.siteName}：${plan.localRoot} → ${plan.target}；共 ${plan.total} 个文件，${formatBytes(plan.totalSize)}。${plan.includeEnvironment ? '已允许覆盖数据库与环境配置。' : '保留数据库与环境配置。'}${plan.dependencies?.length ? ` 已包含 ${plan.dependencies.length} 个模板依赖，先上传并校验功能代码，再上传模板。` : ''}`;
    $('fmPlanItems').innerHTML = plan.files.map(file => `<tr><td>${escapeHtml(file.relativePath)}${file.dependency ? `<small class="subtitle"> · 模板依赖：${escapeHtml(file.dependency)}</small>` : ''}</td><td>${formatBytes(file.size)}</td></tr>`).join('');
    $('fmExcluded').hidden = !plan.skipped.length; $('fmExcludedItems').textContent = plan.skipped.join('\n');
    $('fmPreview').hidden = false; message('请核对清单与 FTP 目标，再点击确认覆盖上传。计划 10 分钟内有效。');
  }
  $('fmPlan').onclick = () => action(previewSelection);
  $('fmTemplatePlan').onclick = () => action(async () => {
    $('fmEnvironment').checked = false;
    selected.clear(); selected.add('template');
    await loadLocal('');
    await previewSelection();
  });
  async function poll() {
    try {
      const state = await api('/api/upload/status');
      if (state.siteId !== siteId) throw new Error('当前上传状态属于其他站点，请查看发布日志');
      message(state.error ? `上传失败：${state.error}；已上传 ${state.uploaded}/${state.total}` : state.running ? `覆盖上传 ${state.uploaded}/${state.total}：${state.current || '正在连接'}` : `文件传输完成：${state.uploaded} 个文件。请刷新线上页面核对效果；仍显示旧内容时在 PB 后台清理缓存。` , Boolean(state.error));
      if (state.running) { setTimeout(poll, 1200); return; }
      running = false; lock(false); invalidate();
    } catch (error) { message(`状态读取失败：${error.message}。正在重试，请勿重复上传。`, true); setTimeout(poll, 3000); }
  }
  $('fmUpload').onclick = () => action(async () => {
    if (!plan) throw new Error('请先预览上传清单');
    await postJson('/api/files/upload', { siteId, token: plan.token });
    running = true; message('开始覆盖上传…'); window.dispatchEvent(new Event('selected-upload-started')); poll();
  });
  action(() => loadLocal(''));
})();
