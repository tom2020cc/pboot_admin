<template>
  <section class="page sites-page">
    <div class="page-bar">
      <div>
        <h2>站点管理</h2>
        <p>一套管理中心维护多个 PbootCMS 网站，内容操作始终跟随顶部选中的当前站点。</p>
      </div>
      <div class="page-actions">
        <el-button @click="$router.push('/template-bindings')">模板栏目绑定</el-button>
        <el-button :icon="Search" @click="$router.push('/site-resources')">资源检测</el-button>
        <el-button :icon="FolderOpened" @click="openScanner">扫描网站</el-button>
        <el-button :icon="CircleCheck" :loading="checkingAll" @click="checkAllSites">批量检查</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增站点</el-button>
      </div>
    </div>

    <el-alert type="info" :closable="false" show-icon>
      <template #title>
        模型 API Key 是系统公共配置，所有站点共享；网站目录、Pboot 数据库、线上网址和 YouTube 频道 ID 按站点单独保存。
      </template>
    </el-alert>

    <div class="shared-settings">
      <div class="shared-copy">
        <strong>共享 YouTube Data API Key</strong>
        <span>所有网站共用一个 API Key；每个网站在编辑站点时填写自己的频道 ID。</span>
      </div>
      <el-tag :type="sharedSettings.youtubeApiKeyConfigured ? 'success' : 'warning'" effect="plain">
        {{ sharedSettings.youtubeApiKeyConfigured ? `已配置 ${sharedSettings.youtubeApiKeyMasked}` : "未配置" }}
      </el-tag>
      <el-input
        v-model="youtubeApiKeyInput"
        type="password"
        show-password
        placeholder="输入新 Key；留空保持原值"
        @keyup.enter="saveYoutubeApiKey"
      />
      <el-button type="primary" :loading="savingSharedSettings" @click="saveYoutubeApiKey">保存 Key</el-button>
    </div>

    <div class="site-summary" aria-label="站点统计">
      <div><span>站点总数</span><strong>{{ sites.length }}</strong></div>
      <div><span>启用</span><strong class="success">{{ enabledCount }}</strong></div>
      <div><span>停用</span><strong>{{ disabledCount }}</strong></div>
      <div><span>检查正常</span><strong class="success">{{ passedCount }}</strong></div>
      <div><span>检查异常</span><strong class="danger">{{ failedCount }}</strong></div>
    </div>

    <div class="site-toolbar">
      <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜索站点名称、标识、网址或路径" />
      <el-select v-model="environmentFilter" aria-label="运行环境">
        <el-option label="全部环境" value="all" />
        <el-option label="phpStudy" value="phpstudy" />
        <el-option label="宝塔" value="baota" />
        <el-option label="远程/挂载" value="remote" />
      </el-select>
      <el-select v-model="statusFilter" aria-label="站点状态">
        <el-option label="全部状态" value="all" />
        <el-option label="仅启用" value="enabled" />
        <el-option label="仅停用" value="disabled" />
        <el-option label="仅默认" value="default" />
        <el-option label="仅异常" value="failed" />
      </el-select>
      <span class="filter-total">显示 {{ filteredSites.length }} / {{ sites.length }}</span>
    </div>

    <div class="white-card table-shell">
      <el-table v-loading="loading" :data="pagedSites" row-key="id" :row-class-name="rowClassName">
        <el-table-column label="站点" min-width="190">
          <template #default="{ row }">
            <div class="site-name">
              <div>
                <strong>{{ row.name }}</strong>
                <el-tag v-if="row.id === activeSiteId" size="small" type="primary">当前</el-tag>
              </div>
              <span>{{ row.code }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="环境" width="110">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ environmentLabel[row.environment as SiteEnvironment] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="rootPath" label="网站根目录" min-width="250" show-overflow-tooltip />
        <el-table-column prop="dbPath" label="Pboot 数据库" min-width="260" show-overflow-tooltip />
        <el-table-column label="线上网址 / YouTube" min-width="220">
          <template #default="{ row }">
            <div class="site-links">
              <a v-if="row.publicBaseUrl" :href="row.publicBaseUrl" target="_blank" rel="noopener">{{ row.publicBaseUrl }}</a>
              <span v-else class="muted">未填写线上网址</span>
              <span v-if="row.youtubeChannelId" class="channel-id">{{ row.youtubeChannelId }}</span>
              <span v-else class="muted">未配置频道</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="126" align="center">
          <template #default="{ row }">
            <div class="status-stack">
              <el-tag v-if="row.isDefault" type="success" size="small">默认</el-tag>
              <el-tag v-else-if="row.enabled" size="small" effect="plain">启用</el-tag>
              <el-tag v-else type="info" size="small">停用</el-tag>
              <span v-if="checkResults[row.id]" :class="checkResults[row.id].ok ? 'check-ok' : 'check-failed'">
                {{ checkResults[row.id].ok ? "检查正常" : "配置异常" }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="236" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.enabled && row.id !== activeSiteId" link type="success" @click="switchSite(row)">切换</el-button>
            <el-button link type="primary" @click="checkSite(row)">检查</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-dropdown trigger="click" @command="(command: string) => handleCommand(command, row)">
              <el-tooltip content="更多操作" placement="top">
                <el-button link :icon="MoreFilled" aria-label="更多操作" />
              </el-tooltip>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="copy">复制配置</el-dropdown-item>
                  <el-dropdown-item v-if="!row.isDefault && row.enabled" command="default">设为默认</el-dropdown-item>
                  <el-dropdown-item command="toggle">{{ row.enabled ? "停用站点" : "启用站点" }}</el-dropdown-item>
                  <el-dropdown-item v-if="!row.isDefault" command="delete" divided>删除站点</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="filteredSites.length" class="pagination-row">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="filteredSites.length"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑站点' : '新增站点'" width="min(760px, calc(100vw - 32px))" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <div class="form-grid">
          <el-form-item label="站点名称" prop="name">
            <el-input v-model="form.name" placeholder="例如：山博中文站" />
          </el-form-item>
          <el-form-item label="站点标识" prop="code">
            <el-input v-model="form.code" placeholder="例如：shanbo-cn" />
          </el-form-item>
          <el-form-item label="运行环境" prop="environment">
            <el-select v-model="form.environment">
              <el-option label="phpStudy 本地" value="phpstudy" />
              <el-option label="宝塔服务器" value="baota" />
              <el-option label="远程/挂载目录" value="remote" />
            </el-select>
          </el-form-item>
          <el-form-item label="线上网址">
            <el-input v-model="form.publicBaseUrl" placeholder="https://example.com" />
          </el-form-item>
        </div>
        <el-form-item label="PbootCMS 网站根目录" prop="rootPath">
          <el-input v-model="form.rootPath" placeholder="E:/phpstudy_pro/WWW/example.com" />
        </el-form-item>
        <el-form-item label="PbootCMS 数据库文件" prop="dbPath">
          <el-input v-model="form.dbPath" placeholder="E:/phpstudy_pro/WWW/example.com/data/xxx.db" />
        </el-form-item>
        <el-form-item label="本站 YouTube 频道 ID">
          <el-input v-model="form.youtubeChannelId" placeholder="UC 开头的频道 ID；没有可留空" />
          <div class="field-hint">YouTube API Key 为系统公共配置；这里只设置当前网站使用的频道。</div>
        </el-form-item>
        <el-form-item label="站点配置目录">
          <el-input :model-value="editingSiteConfigPath" readonly placeholder="保存后自动创建 managed-sites/站点标识" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="2" placeholder="记录服务器、用途或部署说明" />
        </el-form-item>
        <div class="switch-row">
          <el-checkbox v-model="form.enabled">启用此站点</el-checkbox>
          <el-checkbox v-model="form.isDefault">设为默认站点</el-checkbox>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSite">保存站点</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scannerVisible" title="扫描 PbootCMS 网站" width="min(980px, calc(100vw - 32px))" destroy-on-close>
      <div class="scanner-bar">
        <el-input v-model="scanner.parentPath" placeholder="网站父目录，例如 E:/phpstudy_pro/WWW 或 /www/wwwroot" />
        <el-select v-model="scanner.environment">
          <el-option label="phpStudy" value="phpstudy" />
          <el-option label="宝塔" value="baota" />
          <el-option label="远程/挂载" value="remote" />
        </el-select>
        <el-button type="primary" :icon="Search" :loading="scanning" @click="runScanner">开始扫描</el-button>
      </div>
      <p class="scanner-note">只扫描父目录的下一层，并识别包含 PbootCMS 程序结构和 data 数据库的网站。</p>

      <el-table
        ref="scannerTableRef"
        v-loading="scanning"
        :data="scanCandidates"
        row-key="rootPath"
        max-height="420"
        @selection-change="scanSelection = $event"
      >
        <el-table-column type="selection" width="48" :selectable="(row: DiscoveredSite) => !row.existingSiteId" />
        <el-table-column prop="name" label="网站" min-width="150" />
        <el-table-column prop="rootPath" label="根目录" min-width="260" show-overflow-tooltip />
        <el-table-column prop="dbPath" label="识别数据库" min-width="270" show-overflow-tooltip />
        <el-table-column label="结果" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.existingSiteId" type="info" size="small">已存在</el-tag>
            <el-tag v-else type="success" size="small">可导入</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <span class="scan-summary">发现 {{ scanCandidates.length }} 个，选择 {{ scanSelection.length }} 个</span>
        <el-button @click="scannerVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importing" :disabled="!scanSelection.length" @click="importScannedSites">导入选中网站</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { FormInstance, FormRules, TableInstance } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import { CircleCheck, FolderOpened, MoreFilled, Plus, Search } from "@element-plus/icons-vue";
import {
  createSite,
  discoverSites,
  getSharedSiteSettings,
  removeSite,
  setDefaultSite,
  saveSharedSiteSettings,
  testAllSites,
  testSite,
  updateSite,
  type DiscoveredSite,
  type ManagedSite,
  type SaveManagedSite,
  type SiteEnvironment,
  type SiteTestResult,
} from "@/api/sites";
import { getErrorMessage } from "@/utils/request";
import { useSitesStore } from "@/stores/sites";

const store = useSitesStore();
const { sites, loading, activeSiteId } = storeToRefs(store);
const dialogVisible = ref(false);
const editingId = ref(0);
const saving = ref(false);
const checkingAll = ref(false);
const savingSharedSettings = ref(false);
const youtubeApiKeyInput = ref("");
const sharedSettings = reactive({ youtubeApiKeyConfigured: false, youtubeApiKeyMasked: "" });
const keyword = ref("");
const environmentFilter = ref<"all" | SiteEnvironment>("all");
const statusFilter = ref("all");
const currentPage = ref(1);
const pageSize = ref(20);
const formRef = ref<FormInstance>();
const checkResults = reactive<Record<number, SiteTestResult>>({});

const scannerVisible = ref(false);
const scanning = ref(false);
const importing = ref(false);
const scanCandidates = ref<DiscoveredSite[]>([]);
const scanSelection = ref<DiscoveredSite[]>([]);
const scannerTableRef = ref<TableInstance>();
const scanner = reactive<{ parentPath: string; environment: SiteEnvironment }>({ parentPath: "", environment: "phpstudy" });

const environmentLabel: Record<SiteEnvironment, string> = {
  phpstudy: "phpStudy",
  baota: "宝塔",
  remote: "远程/挂载",
};

const emptyForm = (): SaveManagedSite => ({
  name: "",
  code: "",
  environment: "phpstudy",
  rootPath: "",
  dbPath: "",
  publicBaseUrl: "",
  youtubeChannelId: "",
  enabled: true,
  isDefault: false,
  notes: "",
});

const form = reactive<SaveManagedSite>(emptyForm());
const rules: FormRules = {
  name: [{ required: true, message: "请填写站点名称", trigger: "blur" }],
  code: [{ required: true, message: "请填写站点标识", trigger: "blur" }],
  rootPath: [{ required: true, message: "请填写网站根目录", trigger: "blur" }],
  dbPath: [{ required: true, message: "请填写 PbootCMS 数据库路径", trigger: "blur" }],
};

const enabledCount = computed(() => sites.value.filter((site) => site.enabled).length);
const disabledCount = computed(() => sites.value.length - enabledCount.value);
const passedCount = computed(() => Object.values(checkResults).filter((result) => result.ok).length);
const failedCount = computed(() => Object.values(checkResults).filter((result) => !result.ok).length);
const editingSiteConfigPath = computed(() => {
  const current = sites.value.find((site) => site.id === editingId.value);
  return current?.configPath || (form.code ? `managed-sites/${form.code}/site.json` : "");
});
const filteredSites = computed(() => {
  const search = keyword.value.trim().toLowerCase();
  return sites.value.filter((site) => {
    if (environmentFilter.value !== "all" && site.environment !== environmentFilter.value) return false;
    if (statusFilter.value === "enabled" && !site.enabled) return false;
    if (statusFilter.value === "disabled" && site.enabled) return false;
    if (statusFilter.value === "default" && !site.isDefault) return false;
    if (statusFilter.value === "failed" && checkResults[site.id]?.ok !== false) return false;
    if (!search) return true;
    return [site.name, site.code, site.publicBaseUrl, site.rootPath, site.dbPath, site.notes]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
});
const pagedSites = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredSites.value.slice(start, start + pageSize.value);
});

watch([keyword, environmentFilter, statusFilter, pageSize], () => { currentPage.value = 1; });

const toSaveSite = (site: ManagedSite): SaveManagedSite => ({
  name: site.name,
  code: site.code,
  environment: site.environment,
  rootPath: site.rootPath,
  dbPath: site.dbPath,
  publicBaseUrl: site.publicBaseUrl,
  youtubeChannelId: site.youtubeChannelId || "",
  enabled: site.enabled,
  isDefault: site.isDefault,
  notes: site.notes,
});

const resetForm = (values: SaveManagedSite = emptyForm()) => Object.assign(form, values);

const openCreate = () => {
  editingId.value = 0;
  resetForm({ ...emptyForm(), environment: sites.value[0]?.environment || "phpstudy" });
  dialogVisible.value = true;
};

const openEdit = (site: ManagedSite) => {
  editingId.value = site.id;
  resetForm(toSaveSite(site));
  dialogVisible.value = true;
};

const copySite = (site: ManagedSite) => {
  editingId.value = 0;
  resetForm({ ...toSaveSite(site), name: `${site.name} 副本`, code: `${site.code}-copy`, isDefault: false });
  dialogVisible.value = true;
};

const saveSite = async () => {
  if (!(await formRef.value?.validate())) return;
  saving.value = true;
  try {
    if (editingId.value) await updateSite(editingId.value, { ...form });
    else await createSite({ ...form });
    ElMessage.success("站点配置已保存");
    dialogVisible.value = false;
    await store.refresh();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "保存站点失败"));
  } finally {
    saving.value = false;
  }
};

const loadSharedSettings = async () => {
  try {
    Object.assign(sharedSettings, (await getSharedSiteSettings()).data);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "读取共享配置失败"));
  }
};

const saveYoutubeApiKey = async () => {
  if (!youtubeApiKeyInput.value.trim()) {
    ElMessage.info("请输入新的 YouTube Data API Key；留空不会覆盖原值");
    return;
  }
  savingSharedSettings.value = true;
  try {
    Object.assign(sharedSettings, (await saveSharedSiteSettings({ youtubeApiKey: youtubeApiKeyInput.value.trim() })).data);
    youtubeApiKeyInput.value = "";
    ElMessage.success("共享 YouTube API Key 已保存，所有网站立即可用");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "保存共享 Key 失败"));
  } finally {
    savingSharedSettings.value = false;
  }
};

const checkSite = async (site: ManagedSite) => {
  try {
    const result = (await testSite(site.id)).data;
    checkResults[site.id] = result;
    (result.ok ? ElMessage.success : ElMessage.warning)(`${site.name}：${result.message}`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "站点检查失败"));
  }
};

const checkAllSites = async () => {
  checkingAll.value = true;
  try {
    const result = (await testAllSites()).data;
    result.results.forEach((item) => { checkResults[item.siteId] = item; });
    (result.failed ? ElMessage.warning : ElMessage.success)(`检查完成：正常 ${result.passed} 个，异常 ${result.failed} 个`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "批量检查失败"));
  } finally {
    checkingAll.value = false;
  }
};

const makeDefault = async (site: ManagedSite) => {
  try {
    await setDefaultSite(site.id);
    ElMessage.success(`${site.name} 已设为默认站点`);
    await store.refresh();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "设置默认站点失败"));
  }
};

const toggleSite = async (site: ManagedSite) => {
  try {
    if (site.enabled) {
      await ElMessageBox.confirm(`停用“${site.name}”后不能切换到该站点，是否继续？`, "停用站点", {
        confirmButtonText: "停用",
        cancelButtonText: "取消",
        type: "warning",
      });
    }
    await updateSite(site.id, { ...toSaveSite(site), enabled: !site.enabled, isDefault: site.enabled ? false : site.isDefault });
    ElMessage.success(site.enabled ? "站点已停用" : "站点已启用");
    await store.refresh();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getErrorMessage(error, "修改站点状态失败"));
  }
};

const deleteSite = async (site: ManagedSite) => {
  try {
    await ElMessageBox.confirm(`确定删除站点“${site.name}”吗？不会删除网站文件。`, "删除站点", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
    });
    await removeSite(site.id);
    delete checkResults[site.id];
    ElMessage.success("站点配置已删除");
    await store.refresh();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getErrorMessage(error, "删除站点失败"));
  }
};

const switchSite = (site: ManagedSite) => store.selectSite(site.id);

const handleCommand = (command: string, site: ManagedSite) => {
  if (command === "copy") copySite(site);
  if (command === "default") void makeDefault(site);
  if (command === "toggle") void toggleSite(site);
  if (command === "delete") void deleteSite(site);
};

const parentPathOf = (value: string) => {
  const normalized = String(value || "").replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index > 0 ? normalized.slice(0, index) : "";
};

const openScanner = () => {
  scanner.parentPath = parentPathOf(sites.value[0]?.rootPath || "") || "E:/phpstudy_pro/WWW";
  scanner.environment = sites.value[0]?.environment || "phpstudy";
  scanCandidates.value = [];
  scanSelection.value = [];
  scannerVisible.value = true;
};

const runScanner = async () => {
  if (!scanner.parentPath.trim()) {
    ElMessage.warning("请填写网站父目录");
    return;
  }
  scanning.value = true;
  try {
    const result = (await discoverSites({ ...scanner })).data;
    scanCandidates.value = result.candidates;
    scanSelection.value = [];
    await nextTick();
    result.candidates.filter((item) => !item.existingSiteId).forEach((item) => scannerTableRef.value?.toggleRowSelection(item, true));
    ElMessage.success(`扫描完成：发现 ${result.foundSites} 个网站，其中 ${result.newSites} 个可导入`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "扫描网站失败"));
  } finally {
    scanning.value = false;
  }
};

const importScannedSites = async () => {
  importing.value = true;
  let imported = 0;
  const failures: string[] = [];
  try {
    for (const [index, candidate] of scanSelection.value.entries()) {
      try {
        const { existingSiteId: _existingSiteId, databaseCount: _databaseCount, ...values } = candidate;
        await createSite({ ...values, isDefault: !sites.value.length && index === 0 });
        imported += 1;
      } catch (error) {
        failures.push(`${candidate.name}：${getErrorMessage(error, "导入失败")}`);
      }
    }
    await store.refresh();
    if (failures.length) ElMessage.warning(`导入 ${imported} 个，失败 ${failures.length} 个：${failures[0]}`);
    else ElMessage.success(`已导入 ${imported} 个网站`);
    if (imported) await runScanner();
  } finally {
    importing.value = false;
  }
};

const rowClassName = ({ row }: { row: ManagedSite }) => row.id === activeSiteId.value ? "current-site-row" : "";

store.refresh().catch((error) => ElMessage.error(getErrorMessage(error, "读取站点失败")));
loadSharedSettings();
</script>

<style scoped lang="scss">
.page-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.shared-settings {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto minmax(280px, 420px) auto;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.shared-copy { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.shared-copy span { color: var(--el-text-color-secondary); font-size: 12px; }
.site-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  margin: 14px 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.site-summary > div { min-height: 76px; padding: 14px 18px; border-right: 1px solid var(--el-border-color-lighter); }
.site-summary > div:last-child { border-right: 0; }
.site-summary span { display: block; margin-bottom: 5px; color: var(--el-text-color-secondary); font-size: 12px; }
.site-summary strong { font-size: 23px; }
.site-summary .success { color: var(--el-color-success); }
.site-summary .danger { color: var(--el-color-danger); }
.site-toolbar { display: grid; grid-template-columns: minmax(280px, 1fr) 150px 150px auto; align-items: center; gap: 10px; margin-bottom: 12px; }
.filter-total { color: var(--el-text-color-secondary); font-size: 13px; white-space: nowrap; }
.table-shell { overflow: hidden; }
.site-name { display: flex; flex-direction: column; gap: 4px; }
.site-name > div { display: flex; align-items: center; gap: 7px; }
.site-name span, .muted { color: var(--el-text-color-secondary); font-size: 12px; }
.site-links { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.site-links a { overflow: hidden; color: var(--el-color-primary); text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.channel-id { overflow: hidden; color: var(--el-text-color-regular); font-family: Consolas, monospace; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.status-stack { display: flex; align-items: center; flex-direction: column; gap: 5px; }
.check-ok, .check-failed { font-size: 11px; }
.check-ok { color: var(--el-color-success); }
.check-failed { color: var(--el-color-danger); }
.pagination-row { display: flex; justify-content: flex-end; padding: 14px 16px; border-top: 1px solid var(--el-border-color-lighter); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.form-grid :deep(.el-select) { width: 100%; }
.switch-row { display: flex; gap: 24px; }
.field-hint { margin-top: 5px; color: var(--el-text-color-secondary); font-size: 12px; }
.scanner-bar { display: grid; grid-template-columns: minmax(340px, 1fr) 150px auto; gap: 10px; }
.scanner-note { margin: 10px 0 14px; color: var(--el-text-color-secondary); font-size: 13px; }
.scan-summary { margin-right: auto; color: var(--el-text-color-secondary); }
:deep(.current-site-row td.el-table__cell) { background: var(--el-color-primary-light-9); }
@media (max-width: 980px) {
  .site-summary { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  .site-summary > div { border-bottom: 1px solid var(--el-border-color-lighter); }
  .site-toolbar, .scanner-bar, .shared-settings { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .page-actions { justify-content: flex-start; }
  .site-summary { grid-template-columns: 1fr; }
  .form-grid { grid-template-columns: 1fr; }
}
</style>
