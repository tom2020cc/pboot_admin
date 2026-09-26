<template>
  <section v-loading="loading" class="license-settings" aria-label="系统授权码">
    <div class="license-heading">
      <div><h3>系统授权码</h3><p>{{ data?.siteName || '当前站点' }} · 本地与宝塔授权配置分别保存</p></div>
      <el-button :disabled="busy || !siteId" @click="load">重新读取 PB</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <template v-if="data">
      <div class="license-current">
        <el-tag>{{ data.activeEnvironment ? labels[data.activeEnvironment] : '远程 / 挂载环境' }}</el-tag>
        <span>当前访问域名：{{ data.publicDomain || '未设置' }}</span>
        <span>PB 当前授权码：</span>
        <el-input :model-value="data.live.codes" type="password" show-password readonly aria-label="PB 当前系统授权码" />
      </div>
      <p class="license-hint">授权码只需在首次配置或变更时同步，日常发布代码无需重复操作。多个授权码用英文逗号分隔，域名列表不修改网站域名绑定。</p>
      <el-alert v-if="data.onlineSync" :title="data.onlineSync.message" :type="data.onlineSync.ok ? 'success' : 'error'" :closable="false" show-icon />
      <div class="license-grid">
        <el-form v-for="env in environments" :key="env" label-position="top" class="license-card">
          <div class="license-card-title"><strong>{{ labels[env] }}</strong><el-tag v-if="env === data.activeEnvironment" type="success" size="small">当前环境</el-tag></div>
          <el-form-item :label="env === 'phpstudy' ? '本地域名' : '线上域名'">
            <el-input v-model="forms[env].domains" type="textarea" :rows="3" :disabled="busy" :aria-label="`${labels[env]}域名`" placeholder="每行一个域名，例如 example.com" />
          </el-form-item>
          <el-form-item label="系统授权码">
            <el-input v-model="forms[env].codes" type="password" show-password autocomplete="off" :disabled="busy" :aria-label="`${labels[env]}系统授权码`" placeholder="填写此环境域名对应的授权码" />
          </el-form-item>
          <el-form-item label="授权码手机（选填）">
            <el-input v-model="forms[env].phone" :disabled="busy" :aria-label="`${labels[env]}授权码手机`" placeholder="购买万能授权码时使用的手机号" />
          </el-form-item>
          <p v-if="env === 'baota' && data.canSyncRemote" class="license-hint">使用当前网站已保存的 FTPS 连接同步。只更新线上授权字段，保留线上内容与本地授权；第一个域名须能通过 HTTPS 访问此网站。</p>
          <p v-else-if="env !== data.activeEnvironment" class="license-hint">保存此环境的备用配置，不修改当前 PB。</p>
          <div class="license-buttons">
            <el-button :disabled="busy" @click="save(env, false)">保存配置</el-button>
            <el-button v-if="env === data.activeEnvironment" type="primary" :loading="saving === env" :disabled="busy || !forms[env].codes.trim()" @click="save(env, true)">保存并写入当前 PB</el-button>
            <el-button v-if="env === 'baota' && data.canSyncRemote" type="primary" :loading="saving === env" :disabled="busy || !forms[env].codes.trim()" @click="save(env, false, true)">保存并同步线上授权码</el-button>
          </div>
        </el-form>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { readSiteLicense, saveSiteLicense, type LicenseEnvironment, type SiteLicense } from '@/api/site-license';
import { getErrorMessage } from '@/utils/request';
const props = defineProps<{ siteId: number }>();
const environments: LicenseEnvironment[] = ['phpstudy', 'baota'];
const labels = { phpstudy: '本地 phpStudy', baota: '线上宝塔' };
const data = ref<SiteLicense | null>(null);
const loading = ref(false);
const saving = ref<LicenseEnvironment | null>(null);
const busy = computed(() => loading.value || saving.value !== null);
const error = ref('');
const forms = reactive({ phpstudy: { domains: '', codes: '', phone: '' }, baota: { domains: '', codes: '', phone: '' } });
let generation = 0;
function populate(value: SiteLicense) {
  data.value = value;
  for (const env of environments) Object.assign(forms[env], { ...value.profiles[env], domains: value.profiles[env].domains.join('\n') });
}
async function load() {
  const current = ++generation;
  data.value = null; error.value = ''; saving.value = null;
  for (const env of environments) Object.assign(forms[env], { domains: '', codes: '', phone: '' });
  if (!props.siteId) { loading.value = false; return; }
  loading.value = true;
  try {
    const response = await readSiteLicense(props.siteId);
    if (current === generation && response.data.siteId === props.siteId) populate(response.data);
  } catch (e) { if (current === generation) error.value = getErrorMessage(e, '授权配置读取失败'); }
  finally { if (current === generation) loading.value = false; }
}
async function save(environment: LicenseEnvironment, apply: boolean, syncRemote = false) {
  if (!data.value || busy.value) return;
  const current = generation, siteId = props.siteId;
  const draft = forms[environment];
  saving.value = environment;
  try {
    const response = await saveSiteLicense(siteId, { environment, apply, syncRemote, revision: data.value.revision,
      domains: draft.domains.split(/[\s,，]+/).filter(Boolean), codes: draft.codes, phone: draft.phone });
    if (current !== generation || siteId !== props.siteId) return;
    // Preserve edits in the other card while updating the saved profile and revision.
    const other: LicenseEnvironment = environment === 'phpstudy' ? 'baota' : 'phpstudy';
    const unsaved = { ...forms[other] };
    populate(response.data); Object.assign(forms[other], unsaved);
    error.value = '';
    if (response.data.onlineSync && !response.data.onlineSync.ok) ElMessage.error('配置已保存，线上同步未确认成功，请查看提示');
    else if (response.data.warnings?.length) ElMessage.warning(response.data.warnings.join('；'));
    else if (response.data.onlineSync?.ok) ElMessage.success(response.data.onlineSync.message);
    else ElMessage.success(apply ? '当前环境授权码已写入 PB' : '此环境授权配置已保存，PB 未变更');
  } catch (e) { if (current === generation) error.value = getErrorMessage(e, '授权配置保存失败'); }
  finally { if (current === generation) saving.value = null; }
}
watch(() => props.siteId, load, { immediate: true });
</script>

<style scoped>
.license-settings { margin: 20px 0; padding: 20px; background: #fff; border: 1px solid #e4e7ed; border-radius: 12px; }
.license-heading, .license-card-title, .license-current, .license-buttons { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.license-heading { justify-content: space-between; margin-bottom: 16px; }
h3 { margin: 0 0 6px; font-size: 18px; }
.license-heading p, .license-hint { margin: 8px 0 16px; color: #667085; font-size: 13px; line-height: 1.6; }
.license-current { margin: 12px 0; font-size: 13px; }
.license-current .el-input { max-width: 340px; }
.license-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.license-card { padding: 16px; border: 1px solid #e4e7ed; border-radius: 8px; min-width: 0; }
.license-card-title { margin-bottom: 16px; }
@media (max-width: 800px) { .license-grid { grid-template-columns: 1fr; } }
</style>
