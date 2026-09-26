<template>
  <section class="information-page" v-loading="loading">
    <header class="page-heading">
      <div class="heading-title"><h1>站点与公司信息</h1><el-tag type="info">{{ info?.siteName || '当前网站' }}</el-tag><el-tag v-if="activeLanguage === 'cn'">CN 基础资料</el-tag></div>
      <div class="actions">
        <el-button :icon="Setting" :disabled="!info || busy || uploading" @click="openSetup">一键配置多语言</el-button>
        <el-tooltip content="重新加载"><el-button :icon="Refresh" :disabled="busy || uploading" aria-label="重新加载" @click="reload" /></el-tooltip>
        <el-button :icon="Download" :disabled="!current || busy || uploading" @click="readPb">从 PB 读取当前语言</el-button>
        <el-button type="primary" :icon="Check" :disabled="!current || busy || uploading" @click="saveCurrent">保存当前语言</el-button>
        <el-dropdown @command="sync" :disabled="!current || busy || uploading">
          <el-button type="success" :disabled="!current || busy || uploading" :icon="Upload">{{ info?.environment === 'phpstudy' ? '同步到本地 PB' : '同步到 PB' }}<el-icon class="dropdown-icon"><ArrowDown /></el-icon></el-button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="current">同步当前语言</el-dropdown-item><el-dropdown-item command="pending">同步全部待同步语言</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
        <el-dropdown v-if="info?.canSyncOnline" @command="syncOnline" :disabled="!current || busy || uploading">
          <el-button type="primary" plain :icon="Upload" :disabled="!current || busy || uploading">同步到线上<el-icon class="dropdown-icon"><ArrowDown /></el-icon></el-button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="current">同步当前语言到线上</el-dropdown-item><el-dropdown-item command="all">同步全部语言到线上</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
      </div>
    </header>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="onlineResult" :title="onlineResult" description="此结果仅确认资料写入。各语言上线前还需检查 DNS 解析、宝塔域名绑定、HTTPS 证书和 PB 官方授权码，并实际打开首页。" type="success" :closable="true" show-icon @close="onlineResult = ''" />
    <template v-if="info">
      <div class="translation-toolbar">
        <el-select v-model="model" class="model-select" :disabled="busy" aria-label="翻译模型" @change="savePreferredTranslationModel">
          <el-option v-for="option in models" :key="option.value" :value="option.value" :label="option.displayLabel || option.label" :disabled="!option.available || option.operational === false" />
        </el-select>
        <el-button :icon="MagicStick" :disabled="!canTranslate || activeLanguage === 'cn'" @click="confirmTranslation([activeLanguage])">只翻译当前语言</el-button>
        <el-button type="primary" :icon="MagicStick" :disabled="!canTranslate" @click="openTranslation">一键翻译</el-button>
        <el-button v-if="failed.length" :disabled="!canTranslate" @click="runTranslation([...failed])">重试失败语言 ({{ failed.length }})</el-button>
        <el-button :icon="CopyDocument" :disabled="busy || !source || !current || activeLanguage === 'cn'" @click="copyShared">从 CN 复制通用资料</el-button>
      </div>
      <TranslationModelInfo v-if="selectedModel" :model="selectedModel" />
      <div v-if="progress" class="progress-row" role="status"><span>{{ progress }}</span><el-button v-if="translating" size="small" :disabled="stopRequested" @click="stopRequested = true">{{ stopRequested ? '当前语言完成后停止' : '停止后续翻译' }}</el-button></div>
      <el-tabs v-model="activeLanguage" class="language-tabs">
        <el-tab-pane v-for="language in info.languages" :key="language.code" :name="language.code" :disabled="busy || uploading">
          <template #label><span>{{ language.name }}<span v-if="isDirty(language.code) || profile(language.code)?.pending" class="pending-dot" :title="isDirty(language.code) ? '未保存' : '待同步 PB'"></span></span></template>
        </el-tab-pane>
      </el-tabs>
      <template v-if="current">
        <div class="record-status">
          <el-tag :type="isDirty(activeLanguage) || current.pending ? 'warning' : 'success'">{{ isDirty(activeLanguage) ? '未保存' : current.pending ? '已保存，待同步 PB' : current.hasDraft ? (info.environment === 'phpstudy' ? '已同步本地 PB' : '已同步 PB') : 'PB 现有资料' }}</el-tag>
          <span v-if="current.translatedModel">翻译模型：{{ current.translatedModel }}</span>
          <el-tag v-if="current.sourceChanged" type="warning">CN 资料已更新</el-tag>
          <el-tag v-if="!current.exists.site || !current.exists.company" type="info">PB 资料尚未完整建立</el-tag>
        </div>
        <el-alert v-if="current.pbChanged" type="warning" title="PB 后台的资料已变化，同步前需要重新读取并核对。" :closable="false" show-icon />
        <el-tabs v-model="section" class="section-tabs">
          <el-tab-pane name="site" label="站点信息" :disabled="busy || uploading" />
          <el-tab-pane name="company" label="公司信息" :disabled="busy || uploading" />
        </el-tabs>
        <fieldset class="form-fieldset" :disabled="busy || uploading">
          <el-form label-position="top" :disabled="busy || uploading" class="information-form" @submit.prevent>
            <el-form-item v-for="field in visibleFields" :key="`${activeLanguage}:${field.section}:${field.key}`" :label="field.label" :class="{ wide: field.type === 'textarea' || field.type === 'image' }">
              <template #label><span>{{ field.label }}</span><el-tooltip v-if="field.translate" content="以 CN 基础资料生成译文"><el-icon class="translatable"><MagicStick /></el-icon></el-tooltip></template>
              <ThumbnailUpload v-if="field.type === 'image'" v-model="current.data[field.section][field.key]" :label="field.label" :upload="uploadAsset" />
              <el-select v-else-if="field.type === 'theme'" v-model="current.data.site.theme" filterable aria-label="站点模板">
                <el-option v-for="theme in themeOptions" :key="theme" :value="theme" :label="theme" />
              </el-select>
              <el-input v-else v-model="current.data[field.section][field.key]" :aria-label="field.label" :type="field.type === 'textarea' ? 'textarea' : 'text'" :rows="field.key === 'statistical' ? 6 : 3" :maxlength="field.maxLength" :dir="activeLanguage === 'ar' && field.translate ? 'rtl' : 'auto'" />
              <div v-if="field.section === 'site' && field.key === 'domain'" class="domain-link-hint">填写主域名。保存后同步到 PB，会同时更新区域绑定并保留 www 等其他域名；清空会解除该语言全部域名绑定。</div>
            </el-form-item>
          </el-form>
        </fieldset>
      </template>
    </template>

    <el-dialog v-model="setupDialog" title="配置多语言站点资料" width="min(1000px, calc(100vw - 32px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
      <template v-if="setupPlan">
        <div class="setup-summary"><strong>{{ setupPlan.siteName }}</strong><el-tag type="warning">CN 补齐空值，保留已有资料</el-tag><el-tag type="info">不含 DNS / SSL / 授权</el-tag></div>
        <el-checkbox-group v-model="setupLanguages" :disabled="busy" class="setup-list">
          <div v-for="item in setupPlan.items" :key="item.language" class="setup-row">
            <el-checkbox :label="item.language" :value="item.language" :disabled="!item.needsChange || !!item.problems.length">{{ item.name }}</el-checkbox>
            <div class="setup-details">
              <div class="setup-meta"><span>模板：{{ item.theme || '未配置' }}</span><span>域名：{{ item.domain || '未绑定' }}</span></div>
              <span v-if="item.createSite || item.createCompany">新建：{{ [item.createSite ? '站点信息' : '', item.createCompany ? '公司信息' : ''].filter(Boolean).join('、') }}</span>
              <span v-if="item.problems.length" class="setup-problem">{{ item.problems.join('；') }}</span>
              <span v-else-if="!item.needsChange" class="setup-complete">资料已完整</span>
              <details v-if="item.changes.length"><summary>{{ item.changes.length }} 项变更</summary><dl><template v-for="change in item.changes" :key="change.field"><dt>{{ change.label }}</dt><dd><del v-if="change.before">{{ change.before }}</del><span>{{ change.after }}</span></dd></template></dl></details>
            </div>
          </div>
        </el-checkbox-group>
      </template>
      <template #footer><el-button :disabled="busy" @click="setupDialog = false">取消</el-button><el-button type="primary" :loading="busy" :disabled="!setupLanguages.length || busy" @click="applySetup">配置并同步到 PB ({{ setupLanguages.length }})</el-button></template>
    </el-dialog>
    <el-dialog v-model="translationDialog" title="从 CN 翻译站点与公司信息" width="min(560px, calc(100vw - 32px))" class="translation-dialog" :close-on-click-modal="false">
      <el-checkbox-group v-model="targets" class="target-languages"><el-checkbox v-for="language in otherLanguages" :key="language.code" :value="language.code" :label="language.code">{{ language.name }}</el-checkbox></el-checkbox-group>
      <template #footer><el-button @click="translationDialog = false">取消</el-button><el-button type="primary" :disabled="!targets.length" @click="confirmTranslation(targets)">开始翻译</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, Check, CopyDocument, Download, MagicStick, Refresh, Setting, Upload } from '@element-plus/icons-vue';
import TranslationModelInfo from '@/components/TranslationModelInfo.vue';
import ThumbnailUpload from '@/components/ThumbnailUpload.vue';
import { uploadImages } from '@/api/uploads';
import { getErrorMessage } from '@/utils/request';
import { getActiveSiteId } from '@/utils/siteSelection';
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from '@/utils/translationModelPreference';
import { getInformation, getInformationModels, getInformationSetup, setupInformation, importInformation, saveInformation, syncInformation, syncInformationOnline, translateInformation,
  type InformationSetup,
  type InformationModel, type InformationProfile, type InformationResponse, type InformationSection } from '@/api/site-information';

const info = ref<InformationResponse>();
const baselines = ref<Record<string, string>>({});
const models = ref<InformationModel[]>([]);
const model = ref('');
const activeLanguage = ref('cn');
const section = ref<InformationSection>('site');
const loading = ref(false);
const busy = ref(false);
const uploading = ref(false);
const error = ref('');
const onlineResult = ref('');
const translating = ref(false);
const stopRequested = ref(false);
const progress = ref('');
const failed = ref<string[]>([]);
const translationDialog = ref(false);
const targets = ref<string[]>([]);
const setupDialog = ref(false);
const setupPlan = ref<InformationSetup>();
const setupLanguages = ref<string[]>([]);
const selectedModel = computed(() => models.value.find(item => item.value === model.value));
const profile = (language: string) => info.value?.profiles.find(item => item.language === language);
const current = computed(() => profile(activeLanguage.value));
const source = computed(() => profile('cn'));
const visibleFields = computed(() => info.value?.fields.filter(field => field.section === section.value) || []);
const themeOptions = computed(() => [...new Set([...(info.value?.themes || []), current.value?.data.site.theme || ''].filter(Boolean))]);
const otherLanguages = computed(() => info.value?.languages.filter(item => item.code !== 'cn') || []);
const canTranslate = computed(() => !!source.value && !!selectedModel.value?.available && selectedModel.value.operational !== false && !busy.value && !uploading.value);
const isDirty = (language: string) => !!profile(language) && JSON.stringify(profile(language)!.data) !== baselines.value[language];
const hasDirty = () => !!info.value?.profiles.some(item => isDirty(item.language));

const apply = (next: InformationResponse, replaced: string[] = []) => {
  const old = info.value;
  for (let index = 0; index < next.profiles.length; index++) {
    const item = next.profiles[index];
    if (old?.siteId === next.siteId && isDirty(item.language) && !replaced.includes(item.language)) {
      next.profiles[index] = old.profiles.find(row => row.language === item.language)!;
    } else baselines.value[item.language] = JSON.stringify(item.data);
  }
  info.value = next;
  if (!next.languages.some(item => item.code === activeLanguage.value)) activeLanguage.value = next.languages[0]?.code || 'cn';
};
const confirm = async (message: string, title: string) => {
  try { await ElMessageBox.confirm(message, title, { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }); return true; } catch { return false; }
};
const action = async (work: () => Promise<void>) => {
  if (busy.value || uploading.value) return;
  busy.value = true; error.value = '';
  try { await work(); } catch (e) { error.value = getErrorMessage(e); ElMessage.error(error.value); }
  finally { busy.value = false; }
};
const load = async () => {
  loading.value = true; error.value = ''; onlineResult.value = '';
  try {
    const response = await getInformation(getActiveSiteId());
    apply(response.data, response.data.languages.map(item => item.code));
    models.value = (await getInformationModels()).data;
    model.value = resolvePreferredTranslationModel(models.value, model.value);
  } catch (e) { error.value = getErrorMessage(e); }
  finally { loading.value = false; }
};
const reload = async () => {
  if (hasDirty() && !await confirm('放弃本页未保存的修改并重新加载？', '重新加载')) return;
  await load();
};
const saveLanguage = async (language: string) => {
  const record = profile(language);
  if (!record || !info.value) return;
  apply((await saveInformation(info.value.siteId, record)).data, [language]);
};
const saveCurrent = () => action(async () => { await saveLanguage(activeLanguage.value); ElMessage.success('已保存到管理后台，尚未同步 PB'); });
const openSetup = async () => {
  if (hasDirty()) { ElMessage.warning('请先保存当前未保存的修改'); return; }
  await action(async () => {
    setupPlan.value = (await getInformationSetup(info.value!.siteId)).data;
    setupLanguages.value = setupPlan.value.items.filter(item => item.needsChange && !item.problems.length).map(item => item.language);
    setupDialog.value = true;
  });
};
const applySetup = async () => {
  if (!setupPlan.value || !await confirm(`向「${setupPlan.value.siteName}」写入 ${setupLanguages.value.length} 个语言的预览变更。空文字暂用 CN 资料，不自动翻译；已有译文和联系方式保留。只更新站点与公司信息及失效模板配置，不修改产品、栏目、授权、DNS 或 SSL。`, '确认配置并同步')) return;
  const plan = setupPlan.value;
  const languages = [...setupLanguages.value];
  await action(async () => {
    const response = await setupInformation(plan.siteId, plan.token, languages);
    apply(response.data, languages);
    setupDialog.value = false;
    if (response.data.warnings?.length) ElMessage.warning(response.data.warnings.join('；'));
    else ElMessage.success(`已配置 ${languages.length} 个语言的 PB 资料`);
  });
};
const readPb = async () => {
  const record = current.value;
  if (!record || !info.value || !await confirm('这会替换当前语言的后台草稿及未保存修改，PB 网站内容不会改变。', '从 PB 读取')) return;
  await action(async () => { apply((await importInformation(info.value!.siteId, record)).data, [record.language]); ElMessage.success('已读取 PB 当前资料'); });
};
const sync = async (scope: string) => {
  const selected = scope === 'current' ? [activeLanguage.value] : info.value?.profiles.filter(item => item.pending || isDirty(item.language)).map(item => item.language) || [];
  if (!selected.length) { ElMessage.info('没有待同步资料'); return; }
  if (!await confirm(`将 ${selected.length} 个语言的站点与公司信息同步到「${info.value?.siteName}」。仅更新这些资料，不修改产品、栏目和模板文件。`, '同步到当前 PB 网站')) return;
  await action(async () => {
    for (const language of selected) if (isDirty(language) || !profile(language)?.hasDraft) await saveLanguage(language);
    const response = await syncInformation(info.value!.siteId, selected.map(language => profile(language)!));
    apply(response.data, selected);
    if (response.data.warnings?.length) ElMessage.warning(response.data.warnings.join('；'));
    else ElMessage.success(`已同步 ${selected.length} 个语言的资料`);
  });
};
const syncOnline = async (scope: string) => {
  if (!info.value?.canSyncOnline || busy.value || uploading.value) return;
  const siteId = info.value.siteId, targetRevision = info.value.onlineTargetRevision || '';
  const selected = scope === 'current' ? [activeLanguage.value] : info.value.languages.map(item => item.code);
  if (!info.value.onlineTarget || !targetRevision) { ElMessage.warning('请先在站点管理填写线上域名，并在网站发布保存 FTPS 连接'); return; }
  const names = selected.map(code => info.value!.languages.find(item => item.code === code)?.name || code).join('、');
  if (!await confirm(`将「${info.value.siteName}」的 ${names} 资料、站点域名、模板选择及引用图片同步到 ${info.value.onlineTarget}。未保存的修改会先保存。空白资料字段会清空线上对应值，缺少的资料记录会自动建立。域名须在当前网站的线上域名列表内，模板文件须已上传。保留线上统计代码、授权码和其他内容。`, '同步站点与公司信息到线上')) return;
  await action(async () => {
    onlineResult.value = '';
    if (info.value?.siteId !== siteId || getActiveSiteId() !== siteId) throw new Error('当前网站已切换，请重新操作');
    for (const language of selected) if (isDirty(language) || !profile(language)?.hasDraft) await saveLanguage(language);
    const result = (await syncInformationOnline(siteId, selected.map(language => profile(language)!), targetRevision)).data;
    if (getActiveSiteId() !== siteId) return;
    onlineResult.value = `本次已同步 ${result.languages.length} 个语言的资料到 ${result.target}，${result.imageCount} 张图片，数据库回读校验通过（${new Date(result.verifiedAt).toLocaleString()}）`;
    if (result.warnings.length) ElMessage.warning(result.warnings.join('；'));
    else ElMessage.success('站点与公司信息已同步到线上');
  });
};
const openTranslation = () => { targets.value = otherLanguages.value.map(item => item.code); translationDialog.value = true; };
const confirmTranslation = async (languages: string[]) => {
  if (!await confirm(`将先保存 CN 基础资料，再翻译 ${languages.length} 个语言。会替换目标语言的可翻译文字，域名、模板、统计代码和联系方式保持原值。译文只保存到后台，不自动同步 PB。`, '确认翻译')) return;
  translationDialog.value = false;
  await runTranslation([...languages]);
};
const runTranslation = async (languages: string[]) => {
  await action(async () => {
    const chosenModel = model.value;
    savePreferredTranslationModel(chosenModel);
    await saveLanguage('cn');
    for (const language of languages) if (isDirty(language)) await saveLanguage(language);
    failed.value = []; stopRequested.value = false; translating.value = true;
    let completed = 0;
    try {
      for (const language of languages) {
        if (stopRequested.value) break;
        const name = info.value!.languages.find(item => item.code === language)?.name || language;
        progress.value = `正在翻译 ${name} (${completed + 1}/${languages.length})`;
        try {
          const response = await translateInformation(info.value!.siteId, profile(language)!, source.value!.revision, chosenModel);
          apply(response.data, [language]);
        } catch (e) { failed.value.push(language); error.value = `${name}：${getErrorMessage(e)}`; }
        completed++;
      }
    } finally {
      translating.value = false;
      progress.value = `${stopRequested.value ? '已停止' : '翻译完成'}：成功 ${completed - failed.value.length}，失败 ${failed.value.length}${completed < languages.length ? `，未处理 ${languages.length - completed}` : ''}。成功的译文已保存。`;
    }
  });
};
const copyShared = async () => {
  const target = current.value;
  if (!target || !source.value || !await confirm('复制 CN 的 Logo、备案、电话、邮箱、邮编、传真、QQ、微信二维码和营业执照代码，覆盖当前语言的对应字段。域名、模板和统计代码保持不变。', '复制通用资料')) return;
  for (const [group, keys] of [['site', ['logo', 'icp']], ['company', ['postcode', 'mobile', 'phone', 'fax', 'email', 'qq', 'weixin', 'blicense']]] as const) {
    for (const key of keys) target.data[group][key] = source.value.data[group][key];
  }
  ElMessage.success('已复制，请保存当前语言');
};
const uploadAsset = async (file: File) => {
  uploading.value = true;
  try { const data = new FormData(); data.append('imgArr', file); return (await uploadImages(data)).data[0] || ''; }
  finally { uploading.value = false; }
};
const beforeUnload = (event: BeforeUnloadEvent) => { if (hasDirty() || busy.value || uploading.value) { event.preventDefault(); event.returnValue = ''; } };
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload); });
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
onBeforeRouteLeave(async () => {
  if (busy.value || uploading.value) { ElMessage.warning('请等待当前操作完成'); return false; }
  return !hasDirty() || await confirm('有尚未保存的修改，确认离开？', '离开页面');
});
</script>

<style scoped>
.information-page { min-width: 0; max-width: 1600px; margin: 0 auto; }
.page-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.heading-title, .actions, .translation-toolbar, .record-status, .progress-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.heading-title h1 { margin: 0 6px 0 0; font-size: 24px; line-height: 1.4; }
.actions .el-button + .el-button, .translation-toolbar .el-button + .el-button { margin-left: 0; }
.dropdown-icon { margin-left: 6px; }
.translation-toolbar { margin: 20px 0 12px; }
.model-select { width: 400px; max-width: 100%; }
.language-tabs { margin-top: 20px; }
.pending-dot { display: inline-block; width: 6px; height: 6px; margin: 0 0 2px 6px; border-radius: 50%; background: #d58a1f; }
.record-status { margin-bottom: 14px; color: #667085; font-size: 13px; }
.section-tabs { margin-top: 16px; }
.form-fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.information-form { padding: 22px 24px; background: #fff; border-top: 1px solid #e5e7eb; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 28px; }
.information-form .wide { grid-column: 1 / -1; }
.information-form :deep(.el-form-item) { min-width: 0; }
.information-form :deep(.el-select) { width: 100%; }
.domain-link-hint { width: 100%; color: #667085; font-size: 12px; line-height: 1.6; margin-top: 6px; }
.information-form :deep(.el-form-item__label) { display: flex; align-items: center; gap: 6px; }
.information-form :deep(.preview.product-thumbnail) { width: min(420px, 100%); height: 138px; aspect-ratio: auto; background: #fafbfc; }
.translatable { color: #8796ad; font-size: 13px; }
.setup-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.setup-list { display: block; max-height: 55vh; overflow-y: auto; }
.setup-row { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 14px; padding: 14px 0; border-top: 1px solid #e5e7eb; }
.setup-details { min-width: 0; display: grid; gap: 8px; font-size: 13px; overflow-wrap: anywhere; }
.setup-meta { display: flex; flex-wrap: wrap; gap: 8px 24px; }
.setup-problem { color: #b54708; }
.setup-complete { color: #15803d; }
.setup-details summary { cursor: pointer; color: #2563eb; }
.setup-details dl { margin: 10px 0 0; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; }
.setup-details dd { margin: 0; white-space: pre-wrap; }
.setup-details del { display: block; color: #b42318; margin-bottom: 4px; }
.progress-row { justify-content: space-between; margin-top: 14px; padding: 10px 0; font-size: 14px; }
.target-languages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.information-page :deep(.el-alert__title) { overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .setup-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  .information-form { grid-template-columns: minmax(0, 1fr); padding: 16px 10px; gap: 0; }
  .heading-title h1 { font-size: 21px; }
  .model-select { width: 100%; }
  .actions { gap: 8px; }
  .information-form :deep(.input-row) { grid-template-columns: minmax(0, 1fr); }
  .information-form :deep(.preview-row) { flex-wrap: wrap; }
  .information-page :deep(.model-info) { max-width: 100%; overflow-wrap: anywhere; }
}
</style>
