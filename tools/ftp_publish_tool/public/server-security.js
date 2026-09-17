(function () {
  const { $, api, postJson, renderNavigation, escapeHtml, formatDate, setStatus } = window.FtpTool;
  let state = null, loaded = false, polling = false, timer, actionRunning = false, preview = null, reading = false;
  const labels = { high: '高风险', medium: '需关注', low: '记录' };
  const endpoint = action => '/api/server-security/' + action;
  function findings() {
    const query = $('search').value.toLowerCase(), severity = $('severity').value;
    const list = (state?.report?.findings || []).filter(f => (severity === 'all' || f.severity === severity ||
      (severity === 'pending' && !f.trusted && !f.quarantined) || (severity === 'trusted' && f.trusted) ||
      (severity === 'quarantined' && f.quarantined)) && (f.path + f.title).toLowerCase().includes(query));
    $('findings').innerHTML = list.length ? list.map(f => `<tr><td><span class="severity ${escapeHtml(f.severity)}">${labels[f.severity]}</span>${f.trusted ? '<span class="file-state">已信任该版本</span>' : f.quarantined ? '<span class="file-state">已移入隔离</span>' : ''}</td><td>${escapeHtml(f.path)}</td><td>${escapeHtml(f.title)}</td><td><div class="file-actions">${f.actionable ? ['读取', '信任', '删除'].map((label, i) => `<button data-read="${escapeHtml(f.path)}" data-intent="${i}" ${state.running || actionRunning ? 'disabled' : ''} class="${i === 2 ? 'danger' : ''}">${label}</button>`).join('') : '<span>需重新扫描或查看隔离区</span>'}</div></td></tr>`).join('') : '<tr><td colspan="4">当前筛选下无记录</td></tr>';
  }
  function records() {
    const disabled = state?.running || actionRunning ? 'disabled' : '';
    $('trustedTitle').textContent = `信任记录 ${state.trusted?.length || 0}`;
    $('trustedRecords').innerHTML = (state.trusted || []).map(t => `<div class="record"><strong>${escapeHtml(t.path)}</strong><small>SHA-256：${escapeHtml(t.hash)} · ${escapeHtml(formatDate(t.time))}</small><p>${escapeHtml(t.reason)}</p><button data-untrust="${escapeHtml(t.id)}" ${disabled}>取消信任</button></div>`).join('') || '暂无信任记录';
    const statuses = { quarantined: '已隔离', restored: '已恢复', pending: '移动待核对', review: '需人工核对', failed: '移动失败' };
    $('quarantineTitle').textContent = `隔离区 ${state.quarantine?.filter(q => q.status !== 'restored' && q.status !== 'failed').length || 0}`;
    $('quarantineRecords').innerHTML = (state.quarantine || []).map(q => `<div class="record"><strong>${escapeHtml(q.path)}</strong> · ${statuses[q.status] || '需核对'}<small>${escapeHtml(formatDate(q.time))} · SHA-256：${escapeHtml(q.hash)}</small>${q.error ? `<p>${escapeHtml(q.error)}</p>` : ''}${['quarantined', 'pending', 'review'].includes(q.status) ? `<button data-restore="${escapeHtml(q.id)}" ${disabled}>恢复到原路径</button>` : ''}</div>`).join('') || '隔离区为空';
    const actions = { trust: '信任当前版本', untrust: '取消信任', 'quarantine-request': '申请移入隔离', quarantine: '已移入隔离', restore: '已恢复' };
    $('actionHistory').innerHTML = (state.audit || []).map(a => `<div class="record">${escapeHtml(formatDate(a.time))} · ${actions[a.action] || escapeHtml(a.action)} · ${escapeHtml(a.path)}<small>操作会话：${escapeHtml(a.actor)}</small></div>`).join('') || '暂无文件处置记录';
  }
  async function refresh() {
    if (polling) return;
    polling = true;
    try {
      state = await api(endpoint('status'));
      renderNavigation(state.navigation, 'ftp');
      $('siteName').textContent = `${state.site.name} · ${state.site.publicBaseUrl || ''}`;
      $('siteRoot').textContent = state.site.root;
      if (!loaded) {
        $('enabled').checked = state.settings.enabled;
        for (const key of ['intervalMinutes', 'maxFiles', 'maxFileMB']) $(key).value = state.settings[key];
        loaded = true;
      }
      const r = state.report;
      const message = state.error || (state.running ? '正在扫描服务器目录' : !r ? '尚未扫描' : !r.complete ? '扫描未完整完成，请查看未读取文件和提示' : r.high || r.medium ? '扫描完成，存在需要人工复核的文件' : '扫描范围内未命中风险规则，不代表不存在恶意文件');
      $('scanMessage').textContent = message;
      $('scanMessage').className = 'server-message' + (state.error || r?.high ? ' error' : '');
      for (const key of ['scanned', 'skipped', 'high', 'medium']) $(key).textContent = (state.running && key in state.progress ? state.progress[key] : r?.[key]) || 0;
      $('progress').textContent = state.running ? state.progress.currentPath || '正在遍历目录' : r ? `完成时间：${formatDate(r.finishedAt)} · 引擎：${r.engine}` : '';
      $('scanBtn').disabled = state.running || actionRunning; $('stopBtn').disabled = !state.running;
      $('baselineBtn').disabled = state.running || !r?.canAdopt; $('downloadBtn').disabled = !r;
      $('baseline').textContent = state.baseline ? `文件指纹基线：${state.baseline.count} 个文件 · ${formatDate(state.baseline.createdAt)}` : '尚未建立文件指纹基线';
      $('nextRun').textContent = state.settings.enabled ? `定时巡检已启用 · 下次计划：${formatDate(state.nextRunAt)}` : '定时巡检未开启';
      $('warnings').textContent = [...(r?.warnings || []), ...(r?.excludedDirectories || []).map(p => `范围排除：${p}`)].join('\n');
      $('history').innerHTML = (state.history || []).map(r => `<div>${escapeHtml(formatDate(r.finishedAt))} · ${r.complete ? '完整' : '未完成'} · 检查 ${r.scanned} · 高风险 ${r.high} · 需关注 ${r.medium}</div>`).join('') || '暂无记录';
      findings(); records(); setStatus(message, !!state.error);
    } catch (error) { setStatus(error.message, true); $('scanMessage').textContent = error.message; }
    finally { polling = false; clearTimeout(timer); timer = setTimeout(refresh, state?.running ? 2000 : 15000); }
  }
  async function action(name, body) {
    if (actionRunning) return;
    actionRunning = true;
    try { await postJson(endpoint(name), body); await refresh(); }
    catch (error) { setStatus(error.message, true); $('scanMessage').textContent = error.message; }
    finally { actionRunning = false; $('scanBtn').disabled = !!state?.running; findings(); records(); }
  }
  $('scanBtn').onclick = () => action('scan');
  $('stopBtn').onclick = () => action('stop');
  $('refreshBtn').onclick = refresh;
  $('saveBtn').onclick = async () => {
    const body = { enabled: $('enabled').checked };
    for (const key of ['intervalMinutes', 'maxFiles', 'maxFileMB']) body[key] = Number($(key).value);
    await action('settings', body);
  };
  $('baselineBtn').onclick = () => {
    if (confirm('确认已经人工复核本次结果？只保存文件 SHA-256 指纹作为比较基线，不复制源文件。')) action('baseline', { confirm: true, reportId: state.report.id });
  };
  $('downloadBtn').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `server-security-site-${state.site.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('severity').onchange = findings; $('search').oninput = findings;
  function reviewButtons() {
    const ready = preview && $('reviewConfirmed').checked && !actionRunning && !reading;
    $('trustFile').disabled = !ready || !$('trustReason').value.trim();
    $('quarantineFile').disabled = !ready;
  }
  async function readFile(relative, intent) {
    if (reading || actionRunning || state?.running) return;
    reading = true; preview = null;
    $('reviewConfirmed').checked = false; $('trustReason').value = ''; $('fileError').textContent = '';
    $('fileMeta').textContent = relative; $('fileContent').textContent = '正在读取…';
    $('fileTitle').textContent = intent === '2' ? '删除前核对文件' : intent === '1' ? '信任前核对文件' : '读取风险文件';
    $('fileDialog').showModal(); reviewButtons();
    try {
      const reportId = state.report.id, result = await postJson(endpoint('read'), { path: relative, reportId });
      if (!$('fileDialog').open) return;
      preview = { ...result, reportId };
      $('fileMeta').textContent = `${result.path}\n${result.size.toLocaleString()} 字节 · 修改时间：${formatDate(result.modifiedAt)}\nSHA-256：${result.hash}\n${result.truncated ? '仅显示前 128 KB，处置前仍会核对完整文件指纹。' : '当前文件读取完成。'}${result.sensitive || result.binary ? ' 请通过宝塔人工核对内容。' : ''}`;
      $('fileMeta').style.whiteSpace = 'pre-wrap';
      $('fileContent').textContent = result.content;
    } catch (error) { $('fileError').textContent = error.message; $('fileContent').textContent = ''; }
    finally { reading = false; reviewButtons(); }
  }
  async function disposition(kind) {
    if (!preview || actionRunning || !$('reviewConfirmed').checked) return;
    const message = kind === 'trust' ? `信任以下文件的当前 SHA-256 版本？\n${preview.path}\n文件内容变化后，重新扫描会再次告警。` : `从网站删除并移入隔离区？\n${preview.path}\n删除程序或核心文件可能使网站无法访问，可从隔离区恢复。`;
    if (!confirm(message)) return;
    actionRunning = true; reviewButtons();
    try {
      await postJson(endpoint(kind), { path: preview.path, reportId: preview.reportId, receipt: preview.receipt,
        reason: $('trustReason').value.trim(), confirm: true });
      $('fileDialog').close(); preview = null; await refresh();
      $('scanMessage').textContent = '文件操作完成，请重新扫描当前网站核对最新状态。';
    } catch (error) { $('fileError').textContent = error.message; }
    finally { actionRunning = false; reviewButtons(); findings(); records(); }
  }
  $('findings').onclick = e => { const button = e.target.closest('button[data-read]'); if (button) readFile(button.dataset.read, button.dataset.intent); };
  $('closeFile').onclick = () => { if (!actionRunning) { $('fileDialog').close(); preview = null; } };
  $('fileDialog').addEventListener('cancel', e => { if (actionRunning) e.preventDefault(); else preview = null; });
  $('reviewConfirmed').onchange = reviewButtons; $('trustReason').oninput = reviewButtons;
  $('trustFile').onclick = () => disposition('trust'); $('quarantineFile').onclick = () => disposition('quarantine');
  $('trustedRecords').onclick = e => {
    const button = e.target.closest('button[data-untrust]'), record = state.trusted?.find(t => t.id === button?.dataset.untrust);
    if (record && confirm(`取消信任 ${record.path}？`)) action('untrust', { id: record.id, confirm: true });
  };
  $('quarantineRecords').onclick = e => {
    const button = e.target.closest('button[data-restore]'), record = state.quarantine?.find(t => t.id === button?.dataset.restore);
    if (record && confirm(`恢复 ${record.path} 到原路径？\n恢复后该文件可被网站访问或执行；不会覆盖已有文件。`)) action('restore', { id: record.id, confirm: true });
  };
  window.addEventListener('pagehide', () => clearTimeout(timer));
  refresh();
})();
