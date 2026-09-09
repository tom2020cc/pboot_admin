<template>
  <section class="seo-page">
    <header class="seo-header">
      <div><h2>SEO 内容计划</h2><p>{{ sites.activeSite?.name || '未选择网站' }} <el-tag size="small">中文 CN</el-tag></p></div>
      <div class="actions"><el-button :icon="Refresh" :disabled="busy" @click="reload">刷新</el-button><el-button :icon="SwitchButton" :type="state?.control.paused ? 'warning' : 'danger'" :disabled="busy || !state" @click="globalSwitch">{{ state?.control.paused ? '解除全局暂停' : '暂停全部网站' }}</el-button></div>
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <div v-if="state" class="status-band">
      <label>当前网站总开关 <el-switch :model-value="state.plan.enabled" :disabled="busy || dirty" aria-label="当前网站总开关" @change="siteSwitch" /></label>
      <el-tag :type="active ? 'success' : 'info'">{{ active ? '运行中' : '已暂停' }}</el-tag>
      <span :class="{ stale: !workerOnline }">任务进程：{{ workerOnline ? '在线' : '未连接' }}</span>
      <span>下次计划：{{ formatDate(state.plan.nextRunAt) }}</span>
      <el-tag v-if="dirty" type="warning">配置未保存</el-tag>
    </div>
    <el-tabs v-if="state" v-model="tab">
      <el-tab-pane label="计划设置" name="settings">
        <el-form label-position="top" class="settings-form" :disabled="busy">
          <div class="field-grid">
            <el-form-item label="所属行业"><el-input v-model="config.industry" maxlength="120" /></el-form-item>
            <el-form-item label="品牌"><el-input v-model="config.brand" maxlength="120" /></el-form-item>
            <el-form-item label="中文新闻栏目"><el-select v-model="config.menuId" filterable aria-label="中文新闻栏目"><el-option v-for="menu in state.menus" :key="menu.id" :value="menu.id" :label="menu.name" /></el-select></el-form-item>
            <el-form-item label="写作模型"><el-select v-model="config.model" filterable aria-label="写作模型"><el-option v-for="model in state.models" :key="model.value" :label="`${model.label}${!model.available ? '（未配置）' : ''}`" :value="model.value" :disabled="!model.available" /></el-select></el-form-item>
            <el-form-item label="生成间隔（小时）"><el-input-number v-model="config.intervalHours" :min="1" :max="168" /></el-form-item>
            <el-form-item label="每日生成任务上限（UTC）"><el-input-number v-model="config.dailyLimit" :min="1" :max="10" /></el-form-item>
          </div>
          <el-form-item label="关键词（每行一个）"><el-input v-model="keywordText" type="textarea" :rows="4" maxlength="5000" /></el-form-item>
          <el-form-item label="HTTPS RSS / Atom 来源（每行一个）"><el-input v-model="feedText" type="textarea" :rows="3" maxlength="10000" /></el-form-item>
          <el-form-item label="写作要求"><el-input v-model="config.instructions" type="textarea" :rows="4" maxlength="5000" /></el-form-item>
          <el-button type="primary" :icon="Check" :loading="busy" :disabled="!dirty" @click="savePlan">保存配置</el-button>
        </el-form>
      </el-tab-pane>
      <el-tab-pane :label="`选题与素材 ${state.sources.length}`" name="sources">
        <div class="section-toolbar"><el-input v-model="sourceSearch" :prefix-icon="Search" clearable placeholder="搜索素材" aria-label="搜索素材" /><div class="actions"><el-button :icon="Download" :disabled="busy || !active || dirty" @click="queue('collect')">采集标题</el-button><el-button type="primary" :icon="Plus" :disabled="busy" @click="openSource()">新增素材</el-button></div></div>
        <el-table :data="visibleSources" row-key="id">
          <el-table-column prop="title" label="选题" min-width="220" />
          <el-table-column label="来源" min-width="200"><template #default="{ row }"><a v-if="row.url" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.url }}</a><span v-else>自有资料</span></template></el-table-column>
          <el-table-column label="核实状态" width="115"><template #default="{ row }"><el-tag :type="row.verified ? 'success' : 'warning'">{{ row.verified ? '已核实' : '待核实' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="220"><template #default="{ row }"><el-button link :icon="Edit" :disabled="busy" @click="openSource(row)">编辑</el-button><el-button link type="primary" :icon="MagicStick" :disabled="busy || !active || !row.verified || dirty" @click="queue('generate', row.id)">生成草稿</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane :label="`草稿与任务 ${state.jobs.length}`" name="jobs">
        <div class="section-toolbar"><el-select v-model="statusFilter" clearable placeholder="全部状态" aria-label="任务状态"><el-option v-for="(label, key) in states" :key="key" :value="key" :label="label" /></el-select><span>{{ workerOnline ? '任务进程在线' : '等待任务进程连接' }}</span></div>
        <el-table :data="visibleJobs" row-key="id">
          <el-table-column label="文章 / 任务" min-width="240"><template #default="{ row }"><strong>{{ row.draft?.title || row.snapshot.source?.title || (row.kind === 'collect' ? '采集来源标题' : '计划执行记录') }}</strong><div class="secondary">{{ row.snapshot.model }} · {{ formatDate(row.createdAt) }}</div><div v-if="row.error" class="error-text">{{ row.error }}</div></template></el-table-column>
          <el-table-column label="状态" width="115"><template #default="{ row }"><el-tag :type="row.status === 'published' ? 'success' : ['failed','uncertain'].includes(row.status) ? 'danger' : 'info'">{{ states[row.status] || row.status }}</el-tag></template></el-table-column>
          <el-table-column label="发布时间" min-width="165"><template #default="{ row }">{{ formatDate(row.scheduledAt) }}</template></el-table-column>
          <el-table-column label="用量" width="100"><template #default="{ row }">{{ row.tokens || 0 }} tokens</template></el-table-column>
          <el-table-column label="操作" min-width="240"><template #default="{ row }">
            <el-button v-if="row.draft" link :icon="View" :disabled="busy" @click="openDraft(row)">{{ row.status === 'draft' ? '编辑审核' : '查看' }}</el-button>
            <el-button v-if="['queued','running','scheduled'].includes(row.status)" link type="warning" :icon="Close" :disabled="busy" @click="jobAction(row, 'cancel')">撤销</el-button>
            <el-button v-if="['failed','paused'].includes(row.status) && !row.newsId && row.attempts < 3" link :icon="RefreshRight" :disabled="busy || !active" @click="jobAction(row, 'retry')">重试</el-button>
            <router-link v-if="row.newsId" :to="`/news/edit/${row.newsId}`">新闻记录</router-link>
          </template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="sourceOpen" :title="sourceId ? '编辑素材' : '新增素材'" width="720px" class="seo-dialog" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
      <el-form label-position="top" :disabled="busy"><el-form-item label="选题标题"><el-input v-model="source.title" maxlength="200" /></el-form-item><el-form-item label="来源链接"><el-input v-model="source.url" maxlength="1000" /></el-form-item><el-form-item label="核实过的事实资料"><el-input v-model="source.notes" type="textarea" :rows="9" maxlength="12000" /></el-form-item><el-checkbox v-model="source.verified">已核实事实，并确认有权使用这些资料</el-checkbox></el-form>
      <template #footer><el-button :disabled="busy" @click="sourceOpen = false">取消</el-button><el-button type="primary" :icon="Check" :loading="busy" @click="saveSource">保存素材</el-button></template>
    </el-dialog>
    <el-dialog v-model="draftOpen" title="中文文章审核" width="1050px" class="seo-dialog" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
      <template v-if="selectedJob">
        <p class="secondary">{{ selectedJob.snapshot.model }} · {{ selectedJob.snapshot.source?.title }} · {{ states[selectedJob.status] }}</p>
        <el-form label-position="top" :disabled="busy || selectedJob.status !== 'draft'">
          <el-form-item label="标题"><el-input v-model="draft.title" maxlength="120" /></el-form-item>
          <div class="field-grid"><el-form-item label="副标题"><el-input v-model="draft.subtitle" maxlength="200" /></el-form-item><el-form-item label="关键词"><el-input v-model="draft.keywords" maxlength="250" /></el-form-item></div>
          <el-form-item label="SEO 描述"><el-input v-model="draft.summary" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
          <el-form-item label="正文 HTML"><el-input v-model="draft.content" type="textarea" :rows="12" maxlength="60000" /></el-form-item>
        </el-form>
        <details><summary>文章预览</summary><iframe title="文章预览" sandbox="" :srcdoc="preview" /></details>
        <div v-if="selectedJob.status === 'draft'" class="review-controls"><el-checkbox v-model="reviewed">已核实参数、事实、来源与内容使用权</el-checkbox><el-date-picker v-model="scheduledAt" type="datetime" placeholder="选择发布时间" aria-label="发布时间" /></div>
      </template>
      <template #footer><el-button :disabled="busy" @click="draftOpen = false">关闭</el-button><el-button v-if="selectedJob?.status === 'draft'" :icon="Check" :disabled="busy" @click="saveDraft">保存草稿</el-button><el-button v-if="selectedJob?.status === 'draft'" type="primary" :icon="Calendar" :disabled="busy || !active || !reviewed || !scheduledAt" @click="schedule">审核并排期</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Calendar, Check, Close, Download, Edit, MagicStick, Plus, Refresh, RefreshRight, Search, SwitchButton, View } from '@element-plus/icons-vue';
import { seoRequest, type SeoConfig, type SeoDraft, type SeoJob, type SeoSource, type SeoState } from '@/api/seoContent';
import { useSitesStore } from '@/stores/sites';
const sites = useSitesStore();
const state = ref<SeoState>(); const busy = ref(false), error = ref(''), tab = ref('settings');
const config = reactive<SeoConfig>({ industry: '', brand: '', instructions: '', keywords: [], feeds: [], model: '', menuId: 0, intervalHours: 24, dailyLimit: 1 });
const keywordText = ref(''), feedText = ref(''), savedConfig = ref(''), sourceSearch = ref(''), statusFilter = ref('');
const sourceOpen = ref(false), sourceId = ref(0), draftOpen = ref(false), reviewed = ref(false), scheduledAt = ref<Date>();
const source = reactive({ title: '', url: '', notes: '', verified: false });
const draft = reactive<SeoDraft>({ title: '', subtitle: '', keywords: '', summary: '', content: '' });
const selectedJob = ref<SeoJob>(); let generation = 0;
const states: Record<string, string> = { queued: '排队中', running: '执行中', draft: '待审核', scheduled: '已排期', publishing: '发布中', published: '已发布', failed: '失败', paused: '已暂停', uncertain: '需核实结果', done: '已完成' };
const active = computed(() => !!state.value?.plan.enabled && !state.value.control.paused);
const workerOnline = computed(() => !!state.value?.control.heartbeat && Date.now() - Date.parse(state.value.control.heartbeat) < 90000);
const payload = () => ({ ...config, keywords: keywordText.value.split('\n').map(s => s.trim()).filter(Boolean), feeds: feedText.value.split('\n').map(s => s.trim()).filter(Boolean) });
const dirty = computed(() => !!state.value && JSON.stringify(payload()) !== savedConfig.value);
const visibleSources = computed(() => state.value?.sources.filter(s => `${s.title} ${s.notes}`.toLowerCase().includes(sourceSearch.value.toLowerCase())) || []);
const visibleJobs = computed(() => state.value?.jobs.filter(j => !statusFilter.value || j.status === statusFilter.value) || []);
const preview = computed(() => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font-family:sans-serif;padding:16px;line-height:1.8;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style>${draft.content}`);
const formatDate = (s: string) => s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '-';
function accept(value: SeoState) { state.value = value; Object.assign(config, value.plan.config); keywordText.value = config.keywords.join('\n'); feedText.value = config.feeds.join('\n'); savedConfig.value = JSON.stringify(payload()); }
async function load(id: number, gen: number, discard = false) {
  const value = (await seoRequest<SeoState>(id)).data;
  if (id !== sites.activeSiteId || gen !== generation) return;
  if (dirty.value && !discard) state.value = value;
  else accept(value);
}
async function run(work: (id: number, current: () => boolean) => Promise<void>) {
  if (busy.value || !sites.activeSiteId) return;
  const id = sites.activeSiteId, gen = generation; const current = () => id === sites.activeSiteId && gen === generation;
  busy.value = true; error.value = '';
  try { await work(id, current); }
  catch (e: any) { if (current()) error.value = [e.response?.data?.message || e.message || '操作失败'].flat().join('；'); }
  finally { if (current()) busy.value = false; }
}
async function confirm(message: string) { try { await ElMessageBox.confirm(message, '确认操作', { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }); return true; } catch { return false; } }
async function reload() { if (dirty.value && !await confirm('放弃尚未保存的配置并重新读取？')) return; await run(async id => load(id, generation, true)); }
async function savePlan() { await run(async (id, current) => { await seoRequest(id, '/plan', 'PATCH', { revision: state.value!.plan.revision, config: payload() }); if (current()) { await load(id, generation, true); ElMessage.success('配置已保存'); } }); }
async function siteSwitch(value: string | number | boolean) { await run(async (id, current) => { if (!await confirm(value ? '开启当前网站的内容计划？只处理本站中文内容。' : '关闭当前网站？排队任务将暂停，已排期文章回到草稿。') || !current()) return; await seoRequest(id, '/switch', 'POST', { enabled: !!value }); if (current()) await load(id, generation); }); }
async function globalSwitch() { await run(async (id, current) => { const enabled = !!state.value!.control.paused; if (!await confirm(enabled ? '解除全局暂停？只有已开启的网站会运行。' : '暂停全部网站？所有排队任务暂停、排期文章退回草稿。') || !current()) return; await seoRequest(id, '/global-switch', 'POST', { enabled }); if (current()) await load(id, generation); }); }
function openSource(row?: SeoSource) { sourceId.value = row?.id || 0; Object.assign(source, row ? { title: row.title, url: row.url, notes: row.notes, verified: row.verified } : { title: '', url: '', notes: '', verified: false }); sourceOpen.value = true; }
async function saveSource() { await run(async (id, current) => { await seoRequest(id, sourceId.value ? `/sources/${sourceId.value}` : '/sources', sourceId.value ? 'PATCH' : 'POST', { ...source }); if (current()) { sourceOpen.value = false; await load(id, generation); } }); }
async function queue(kind: string, sourceId?: number) { await run(async (id, current) => { if (!await confirm(kind === 'generate' ? '使用当前写作模型生成中文草稿？会产生模型调用费用，不会直接发布。' : '开始采集已配置来源中的关键词标题？') || !current()) return; await seoRequest(id, '/jobs', 'POST', { kind, sourceId }); if (current()) { await load(id, generation); tab.value = 'jobs'; } }); }
function openDraft(job: SeoJob) { selectedJob.value = JSON.parse(JSON.stringify(job)); Object.assign(draft, job.draft); reviewed.value = false; scheduledAt.value = undefined; draftOpen.value = true; }
async function saveDraft() { await run(async (id, current) => { const row = (await seoRequest<SeoJob>(id, `/jobs/${selectedJob.value!.id}/draft`, 'PATCH', { revision: selectedJob.value!.revision, draft: { ...draft } })).data; if (current()) { selectedJob.value = row; Object.assign(draft, row.draft); reviewed.value = false; await load(id, generation); ElMessage.success('草稿已保存'); } }); }
async function schedule() { await run(async (id, current) => {
  if (!await confirm('确认审核并按所选时间发布到当前网站中文新闻栏目？') || !current()) return;
  const row = (await seoRequest<SeoJob>(id, `/jobs/${selectedJob.value!.id}/draft`, 'PATCH', { revision: selectedJob.value!.revision, draft: { ...draft } })).data;
  if (!current()) return;
  selectedJob.value = row;
  await seoRequest(id, `/jobs/${row.id}/schedule`, 'POST', { revision: row.revision, scheduledAt: scheduledAt.value!.toISOString() });
  if (current()) { draftOpen.value = false; await load(id, generation); }
}); }
async function jobAction(job: SeoJob, action: string) { await run(async (id, current) => { if (!await confirm(action === 'retry' ? '重试此任务？写作请求可能再次计费。' : '撤销此任务或排期？') || !current()) return; await seoRequest(id, `/jobs/${job.id}/${action}`, 'POST'); if (current()) await load(id, generation); }); }
watch(() => sites.activeSiteId, () => { generation++; state.value = undefined; busy.value = false; error.value = ''; draftOpen.value = false; sourceOpen.value = false; selectedJob.value = undefined; tab.value = 'settings'; if (sites.activeSiteId) void run(async id => load(id, generation)); }, { immediate: true });
watch(() => JSON.stringify(draft), () => { reviewed.value = false; });
const timer = setInterval(() => { if (!busy.value && !dirty.value && !sourceOpen.value && !draftOpen.value && sites.activeSiteId) void run(async id => load(id, generation)); }, 15000);
onUnmounted(() => clearInterval(timer));
onBeforeRouteLeave(async () => !busy.value && (!dirty.value || await confirm('离开并放弃未保存的配置？')));
</script>

<style scoped>
.seo-page{padding:24px;min-width:0;letter-spacing:0}.seo-header,.actions,.section-toolbar,.status-band,.review-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.seo-header,.section-toolbar{justify-content:space-between}.seo-header h2{font-size:22px;margin:0 0 8px}.seo-header p,.secondary{color:#677180;font-size:13px}.seo-header p{display:flex;gap:12px;align-items:center}.status-band{padding:16px 0;border-top:1px solid #dce1e8;border-bottom:1px solid #dce1e8;margin:16px 0}.status-band label{display:flex;align-items:center;gap:12px}.settings-form{max-width:1000px;padding:16px 0}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.el-select{width:100%}.section-toolbar{margin:12px 0 20px}.section-toolbar>.el-input,.section-toolbar>.el-select{max-width:320px}.error-text,.stale{color:#a14c10}.error-text{font-size:12px;margin-top:6px}.secondary{margin-top:6px}.seo-page a{overflow-wrap:anywhere;color:#1677ce}.seo-page :deep(.cell){overflow-wrap:anywhere}.seo-page :deep(.seo-dialog){max-width:calc(100vw - 32px)}.seo-page :deep(.el-dialog__body){overflow-wrap:anywhere}.review-controls{padding-top:20px}.review-controls :deep(.el-checkbox__label){white-space:normal}iframe{display:block;width:100%;height:360px;border:1px solid #dce1e8;margin-top:12px}.seo-page :deep(.el-dialog__footer){display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.seo-page :deep(.el-button+.el-button){margin-left:0}@media(max-width:700px){.seo-page{padding:14px}.field-grid{grid-template-columns:minmax(0,1fr);gap:0}.status-band{align-items:flex-start;flex-direction:column}.seo-header h2{font-size:20px}.section-toolbar>.el-input{max-width:100%}.review-controls{align-items:flex-start;flex-direction:column}}
</style>
