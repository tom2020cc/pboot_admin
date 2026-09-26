(function () {
  const { $, api, postJson, escapeHtml, renderNavigation, setStatus } = window.FtpTool;
  let siteId, preview, local = false, busy = false;
  function controls(running) {
    busy = running;
    $('areaPreview').disabled = !local || running;
    $('areaRun').disabled = !local || running || !preview;
  }
  function message(title, text, kind = 'info') {
    $('areaResultTitle').textContent = title;
    $('areaResultMessage').textContent = text;
    $('areaResult').className = 'result-banner ' + kind;
    setStatus(title, kind === 'fail');
  }
  const describe = row => row ? `${escapeHtml(row.name)}${row.is_default === 1 ? ' · 默认语言' : ''}<small>${escapeHtml(row.domain || '未绑定域名')}</small>` : '线上尚无此区域，将新增';
  async function poll() {
    const state = await api('/api/databases/status');
    if (state.areaSyncSupported !== true) {
      local = false; controls(false);
      message('请先重启本地网站发布工具', '按钮已更新，当前发布服务仍是旧版本。重启网站发布工具后刷新此页，再读取并同步。尚未修改线上配置。', 'warning');
      return;
    }
    controls(state.running);
    const ours = state.action === 'sync-areas' && Number(state.siteId) === Number(siteId);
    if (state.running) {
      message(ours ? '正在同步区域配置' : '发布工具正在执行其他数据库操作', '请等待完成，暂时不要修改两端的区域配置。', 'running');
      if (ours) $('areaLogs').textContent = (state.logs || []).join('\n');
      setTimeout(() => poll().catch(error => { controls(false); message('状态暂时无法读取', '未确认同步结果，请重新读取；不要重复提交。' + error.message, 'fail'); }), 1500);
    } else if (ours && state.error) {
      message('同步未确认完成', state.error, 'fail');
    } else if (ours && state.result?.verified) {
      const r = state.result;
      message('区域配置同步完成', `已核验 ${r.synced} 个区域（新增 ${r.added} 个），保留线上独有区域 ${r.preserved} 个。PB 缓存已清理，可刷新线上区域管理查看。`, 'success');
    }
  }
  $('areaPreview').onclick = async () => {
    if (!local || busy) return;
    preview = null; controls(true); $('areaPlan').hidden = true;
    message('正在读取两端配置', '正在通过当前项目的宝塔连接核对线上网站。', 'running');
    try {
      const p = await postJson('/api/databases/inspect', { scope: 'site', siteId, areasOnly: true });
      if (!Array.isArray(p.areas) || !Array.isArray(p.online?.areas)) throw new Error('发布服务仍是旧版本，请重启本地网站发布工具后再试。尚未同步。');
      const old = new Map(p.online.areas.map(row => [row.acode, row]));
      $('areaRows').innerHTML = p.areas.map(row => `<tr><td>${escapeHtml(row.acode)}</td><td>${describe(old.get(row.acode))}</td><td>${describe(row)}</td></tr>`).join('');
      const extra = p.online.areas.filter(row => !p.areas.some(item => item.acode === row.acode));
      $('areaExtra').textContent = extra.length ? `线上独有区域 ${extra.map(row => row.acode).join('、')} 将保留；默认语言统一按本地设置。` : '全部语言按区域编码对应，不改变线上区域 ID。';
      $('areaTarget').textContent = `当前网站：${p.siteName}　目标数据库：${p.online.path}`;
      preview = p; $('areaPlan').hidden = false;
      message('配置已读取', '核对上方的同步前后配置，确认后点击“确认同步到线上”。');
    } catch (error) { message('读取失败', error.message, 'fail'); }
    finally { controls(false); }
  };
  $('areaRun').onclick = async () => {
    if (!local || busy || !preview) return;
    const p = preview;
    controls(true);
    try {
      await postJson('/api/databases/run', { token: p.token, action: 'sync-areas', confirm: true });
      preview = null;
      await poll();
    } catch (error) {
      preview = null; controls(false);
      message('同步未确认完成', `${error.message} 请重新读取配置后核对结果。`, 'fail');
    }
  };
  (async () => {
    const environment = await api('/deployment-environment');
    local = environment.environment === 'local';
    if (!local) { message('请从本地项目发起', '线上环境不开放本地到线上的区域同步。'); return; }
    const context = await api('/api/sync/config');
    siteId = context.currentSite?.id;
    if (!siteId) throw new Error('请先选择一个本地 phpStudy 网站');
    $('areaSite').textContent = context.currentSite.name;
    renderNavigation(context.navigation, 'ftp');
    controls(false); setStatus('就绪');
    await poll();
  })().catch(error => { local = false; controls(false); message('初始化失败', error.message, 'fail'); });
}());
