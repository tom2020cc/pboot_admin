(function () {
  const { $, api, postJson, renderNavigation, escapeHtml, setStatus } = window.FtpTool;
  const labels = { pass: '通过', fail: '失败', warn: '需注意', unknown: '待确认' };
  const languages = { cn:'中文',en:'English',es:'Español',fr:'Français',ar:'العربية',pt:'Português',ru:'Русский',id:'Bahasa Indonesia',vi:'Tiếng Việt',tr:'Türkçe' };
  let siteId, local = false, timer;
  function render(state) {
    const report = state.result;
    $('startCheck').disabled = !local || state.busy;
    $('startCheck').textContent = state.running ? '检测中…' : '检测全部语言';
    $('checkMessage').textContent = state.running ? '正在服务器上逐项检测，请等待。可离开页面后返回查看结果。' : state.error || (state.stale ? '连接配置已变化，以下为历史结果，请重新检测。' : state.busy ? '另一个站点正在检测，请稍后再试。' : report ? '检测完成。失败和待确认项均需处理后重新检测。' : '等待检测。');
    setStatus(state.running ? '检测中' : state.error ? '检测失败' : '就绪', Boolean(state.error));
    $('checkedAt').textContent = report ? '检测时间：' + new Date(report.checkedAt).toLocaleString() : '';
    const rows = report?.rows || [];
    const ready = rows.filter(row => Object.values(row.checks).every(c => c.status === 'pass')).length;
    $('summary').textContent = rows.length ? `共 ${rows.length} 个语言；全部通过 ${ready} 个；需处理或确认 ${rows.length - ready} 个。` : '';
    $('checkRows').innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${escapeHtml(languages[row.language] || row.language)}</strong><small>${escapeHtml(row.domain || '未配置域名')}</small></td>${['dns','binding','tls','license','template','home'].map(key => {
      const c = row.checks[key] || { status:'unknown',detail:'未返回结果' };
      const status = Object.hasOwn(labels, c.status) ? c.status : 'unknown';
      return `<td><span class="check-badge check-${status}">${labels[status]}</span><div class="check-detail">${escapeHtml(c.detail)}${c.advice ? '<small>' + escapeHtml(c.advice) + '</small>' : ''}</div></td>`;
    }).join('')}</tr>`).join('') : '<tr><td colspan="7">尚无检测结果。</td></tr>';
  }
  async function poll() {
    clearTimeout(timer);
    try {
      const state = await api('/api/domain-check/status');
      if (Number(state.siteId) !== Number(siteId)) throw new Error('当前站点已切换，请刷新页面');
      render(state);
      if (state.busy) timer = setTimeout(poll, 2000);
    } catch (error) { $('checkMessage').textContent = error.message; $('startCheck').disabled = !local; setStatus('读取失败', true); }
  }
  $('startCheck').onclick = async () => {
    if (!local) return;
    $('startCheck').disabled = true;
    try { await postJson('/api/domain-check/start', { siteId }); await poll(); }
    catch (error) { $('checkMessage').textContent = error.message; $('startCheck').disabled = false; setStatus('未开始检测', true); }
  };
  (async () => {
    const environment = await api('/deployment-environment');
    local = environment.environment === 'local';
    if (!local) { $('siteName').textContent = '线上环境'; $('startCheck').hidden = true; $('checkMessage').textContent = '请从本地管理项目发起检测。'; setStatus('本地入口'); return; }
    const context = await api('/api/sync/config');
    siteId = context.currentSite?.id;
    $('siteName').textContent = context.currentSite?.name || '未选择站点';
    renderNavigation(context.navigation, 'ftp');
    await poll();
  })().catch(error => { $('checkMessage').textContent = error.message; setStatus('初始化失败', true); });
}());
