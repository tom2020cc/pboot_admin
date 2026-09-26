(function () {
  const { $, api, postJson, renderNavigation, setStatus } = window.FtpTool;
  const previews = new Map();
  let siteId; let busy = false; let local = false;
  const cards = [...document.querySelectorAll('[data-scope]')];
  const scopeNames = { manager: '管理后台数据库', site: '当前 PB 网站数据库' };
  const tableNames = { product: '产品', product_translations: '产品语言资料', menu: '栏目', news: '新闻', news_translations: '新闻语言资料', page: '单页', page_translations: '单页语言资料', quotations: '报价单', product_brochures: '产品画册', video_item: '视频', video_playlist: '视频列表', seo_content_source: 'SEO 素材', ay_form: '表单配置', ay_form_field: '表单字段' };
  function controls(value) {
    busy = value;
    for (const card of cards) {
      card.querySelector('[data-read]').disabled = value;
      card.querySelector('[data-name]').disabled = value;
      for (const el of card.querySelectorAll('[data-rename], [data-sync]')) el.disabled = value || !previews.has(card.dataset.scope);
    }
  }
  function message(title, text, kind = '') {
    $('databaseResultTitle').textContent = title;
    $('databaseResultMessage').textContent = text;
    $('databaseCounts').textContent = '';
    $('databaseResult').className = 'result-banner ' + kind;
    setStatus(title, kind === 'fail');
  }
  async function poll() {
    const state = await api('/api/databases/status');
    controls(state.running);
    $('databaseLogs').textContent = (state.logs || []).join('\n') || '等待操作。';
    if (state.running) {
      message('数据库处理中', '正在校验、执行并恢复服务，请等待结果。', 'running');
      setTimeout(() => poll().catch(error => message('读取状态失败', error.message, 'fail')), 1500);
    } else if (state.error) message(`${scopeNames[state.scope] || '数据库'}操作未确认完成`, state.error, 'fail');
    else if (state.finishedAt && state.result) {
      message(`${scopeNames[state.scope] || '数据库'}${state.action === 'sync' ? '同步完成' : '操作完成'}`, `线上数据库：${state.result.path}${state.result.counts ? '；已同步 ' + Object.keys(state.result.counts).length + ' 个数据表。' : '；数据库名和连接配置已更新。'}${state.result.contentVerified ? '逐表内容核验通过。管理后台已更新，PB 前台网站数据未改动。' : ''} 完成时间：${new Date(state.finishedAt).toLocaleString()}`, 'success');
      $('databaseCounts').textContent = Object.entries(state.result.counts || {}).map(([name, count]) => `${tableNames[name] || name}：${count} 条`).join('；');
    }
  }
  for (const card of cards) {
    const scope = card.dataset.scope;
    card.querySelector('[data-read]').onclick = async () => {
      if (!local || busy) return;
      controls(true); message('正在读取线上数据库', '正在连接宝塔。', 'running');
      try {
        const p = await postJson('/api/databases/inspect', { scope, siteId });
        previews.set(scope, p);
        card.querySelector('[data-info]').textContent = `本地：${p.source} → 线上：${p.online.path}`;
        card.querySelector('[data-name]').value = p.online.name;
        message('已读取', '核对目标后，可以改名或同步数据。');
      } catch (error) { previews.delete(scope); message('读取失败', error.message, 'fail'); }
      finally { controls(false); }
    };
    async function run(action) {
      if (!local || busy) return;
      const p = previews.get(scope); if (!p) return;
      const name = card.querySelector('[data-name]').value.trim();
      let text = action === 'sync'
        ? `将 ${p.source} 的业务数据覆盖到 ${p.online.path}，空白也会覆盖。${scope === 'manager' ? '范围为全部站点、全部语言的管理数据；线上账号、站点连接、自动任务和站点与公司信息草稿保留，PB 网站数据不变。' : '已有表单字段配置将同步，缺少的可空文本字段将补齐；线上客户留言、旧字段数据、账号、域名、授权配置和连接路径保留。'}图片不包含在内。后台会短暂重启。确定同步吗？`
        : `将线上 ${p.online.path} 改名为 ${name}，并更新连接配置；后台会短暂重启。`;
      if (action === 'rename' && scope === 'site') {
        if (!p.online.phpService) { message('无法自动改名', '未识别当前网站的 PHP 服务，请先核对宝塔网站配置。', 'fail'); return; }
        text += `将短暂停止 ${p.online.phpService}，影响使用该 PHP 服务的 ${p.online.affectedPhpSites} 个网站，操作后恢复。`;
      }
      if (!confirm(text)) return;
      controls(true);
      try {
        await postJson('/api/databases/run', { token: p.token, action, name, confirm: true, allowPhpPause: action === 'rename' && scope === 'site' });
        previews.clear();
        await poll();
      } catch (error) { previews.delete(scope); controls(false); message('操作失败', error.message, 'fail'); }
    }
    card.querySelector('[data-rename]').onclick = () => run('rename');
    card.querySelector('[data-sync]').onclick = () => run('sync');
  }
  (async () => {
    const environment = await api('/deployment-environment');
    local = environment.environment === 'local';
    if (!local) { $('environmentMessage').textContent = '线上环境不显示本地同步操作，请从本地项目发起。'; return; }
    const context = await api('/api/sync/config');
    siteId = context.currentSite?.id;
    $('areaSyncLink').href = '/area-sync.html?siteId=' + encodeURIComponent(siteId || '');
    $('databaseSiteName').textContent = context.currentSite?.name || '未选择站点';
    renderNavigation(context.navigation, 'ftp');
    $('databaseCards').hidden = false;
    setStatus('就绪'); await poll();
  })().catch(error => message('初始化失败', error.message, 'fail'));
}());
