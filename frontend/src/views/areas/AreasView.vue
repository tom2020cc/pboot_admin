<template>
  <section class="page areas-page">
    <div class="page-bar">
      <div>
        <h2>区域管理</h2>
        <p>维护当前站点的语言区域（PbootCMS 多语言），每个区域对应一个独立的内容版本。</p>
      </div>
      <div class="page-actions">
        <el-button v-if="environment === 'local' && sites.activeSite?.environment === 'phpstudy'" :icon="Tools" @click="openProgramRepair">修复并同步 PB 程序</el-button>
        <el-button v-if="environment === 'local' && sites.activeSite?.environment === 'phpstudy'" :icon="Upload" @click="openAreaSync">同步区域配置到线上</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增区域</el-button>
      </div>
    </div>

    <el-alert type="info" :closable="false" show-icon>
      <template #title>
        区域编码为两位小写字母（cn、en、ar 等），创建后不可修改。域名留空表示不做绑定校验；默认区域不能删除。
      </template>
    </el-alert>

    <div class="area-summary" aria-label="区域统计">
      <div><span>区域总数</span><strong>{{ areas.length }}</strong></div>
      <div><span>已绑定域名</span><strong class="success">{{ boundCount }}</strong></div>
      <div><span>未绑定域名</span><strong>{{ areas.length - boundCount }}</strong></div>
    </div>

    <div class="area-toolbar">
      <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜索区域名称、编码或域名" />
      <span class="filter-total">显示 {{ filteredAreas.length }} / {{ areas.length }}</span>
    </div>

    <div class="white-card table-shell">
      <el-table
        v-loading="loading"
        :data="pagedAreas"
        row-key="id"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="50" :selectable="isSelectable" />

        <el-table-column label="区域编码" width="120">
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.acode }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="区域名称" min-width="160">
          <template #default="{ row }">
            <div class="area-name">
              <strong>{{ row.name }}</strong>
              <el-tag v-if="isDefault(row)" size="small" type="primary">默认</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="绑定域名" min-width="220">
          <template #default="{ row }">
            <span v-if="row.domain" class="domain-text">{{ row.domain }}</span>
            <span v-else class="muted">未绑定</span>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" min-width="170">
          <template #default="{ row }">
            <span class="muted">{{ (row.update_time || row.create_time || '').trim() || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="!isDefault(row)" link @click="makeDefault(row)">设为默认</el-button>
            <el-popconfirm
              v-if="!isDefault(row)"
              title="确定删除此区域？该语言下的内容将无法在前台访问。"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm="handleDelete(row.id)"
            >
              <template #reference>
                <el-button link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>

        <template #empty>暂无区域数据</template>
      </el-table>
    </div>

    <div class="pagination-bar">
      <div class="batch-actions">
        <el-button
          v-if="selectedAreas.length"
          type="danger"
          size="small"
          @click="batchDelete"
        >
          批量删除 ({{ selectedAreas.length }})
        </el-button>
      </div>
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="filteredAreas.length"
        layout="total, prev, pager, next"
      />
    </div>

    <el-dialog v-model="programVisible" title="修复 PB 域名识别" width="640px" :close-on-click-modal="false" :close-on-press-escape="!programBusy" :show-close="!programBusy">
      <div v-loading="programLoading" class="program-repair">
        <p>让一个语言支持多个绑定域名，并优先按域名进入对应语言，避免旧语言 Cookie 导致串语言。</p>
        <template v-if="programPreview">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="当前网站">{{ programPreview.siteName }}</el-descriptions-item>
            <el-descriptions-item label="本地状态">{{ programPreview.needsRepair ? '需要修复' : '已修复，可继续同步线上' }}</el-descriptions-item>
            <el-descriptions-item label="程序文件">{{ programPreview.file }}</el-descriptions-item>
            <el-descriptions-item label="线上目标">{{ programPreview.target || '尚未配置 FTPS，请先在网站发布中保存连接' }}</el-descriptions-item>
          </el-descriptions>
          <p class="muted">只修复当前网站的域名识别代码，保留其他自定义代码，不覆盖数据库。修复程序与“同步区域配置”是两个操作。</p>
        </template>
        <el-alert v-if="programMessage" :title="programMessage" :type="programMessageType" :closable="false" show-icon />
      </div>
      <template #footer>
        <el-button :disabled="programBusy" @click="programVisible = false">关闭</el-button>
        <el-button :disabled="!programPreview || programBusy || programDone" @click="runProgramRepair(false)">只修复本地</el-button>
        <el-button type="primary" :loading="programBusy" :disabled="!programPreview?.canSync || programDone" @click="runProgramRepair(true)">修复并同步到线上</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="区域编码" prop="acode">
          <el-input
            v-model="form.acode"
            placeholder="如 en、ar（两位小写字母）"
            :disabled="isEdit"
            maxlength="2"
          />
        </el-form-item>

        <el-form-item label="区域名称" prop="name">
          <el-input v-model="form.name" placeholder="如 英文、阿拉伯语" />
        </el-form-item>

        <el-form-item label="绑定域名" prop="domain">
          <el-input v-model="form.domain" placeholder="如 en.example.com，留空表示不绑定" />
          <div class="muted">多个域名用逗号分隔，第一个会同步为“站点与公司信息”的主域名；清空时两处一起清空。</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isEdit ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { Plus, Search, Upload, Tools } from '@element-plus/icons-vue';
import { useSitesStore } from '@/stores/sites';
import { useDeploymentEnvironment } from '@/composables/useDeploymentEnvironment';
import { buildToolUrls } from '@/utils/toolUrls';
import { API_BASE_URL } from '@/utils/request';
import {
  batchDeleteAreas,
  createArea,
  getAreas,
  removeArea,
  setDefaultArea,
  updateArea,
  type Area,
  previewAreaProgram,
  repairAreaProgram,
  type AreaProgramPreview,
} from '@/api/areas';
import { getErrorMessage } from '@/utils/request';

const loading = ref(false);
const sites = useSitesStore();
const { environment } = useDeploymentEnvironment();
const programVisible = ref(false);
const programLoading = ref(false);
const programBusy = ref(false);
const programDone = ref(false);
const programPreview = ref<AreaProgramPreview>();
const programMessage = ref('');
const programMessageType = ref<'info' | 'success' | 'warning' | 'error'>('info');
const openProgramRepair = async () => {
  if (programBusy.value) return;
  programVisible.value = true;
  programLoading.value = true;
  programDone.value = false;
  programPreview.value = undefined;
  programMessage.value = '';
  const siteId = sites.activeSiteId;
  try {
    const response = await previewAreaProgram(siteId);
    if (sites.activeSiteId !== siteId) throw new Error('网站已切换，请重新打开修复窗口');
    programPreview.value = response.data;
  } catch (error) {
    programMessageType.value = 'error';
    programMessage.value = getErrorMessage(error, '读取程序失败，请确认管理后端已加载最新代码');
  } finally { programLoading.value = false; }
};
const runProgramRepair = async (syncRemote: boolean) => {
  const preview = programPreview.value;
  if (!preview || programBusy.value || programDone.value) return;
  if (preview.siteId !== sites.activeSiteId) {
    programMessageType.value = 'error'; programMessage.value = '网站已切换，请关闭后重新打开'; return;
  }
  programBusy.value = true;
  programMessageType.value = 'info';
  programMessage.value = syncRemote ? '正在修复本地并校验线上程序，请等待结果…' : '正在修复本地程序…';
  try {
    const { data } = await repairAreaProgram({ siteId: preview.siteId, revision: preview.revision, syncRemote });
    programDone.value = true;
    programMessageType.value = data.online?.ok === false ? 'warning' : 'success';
    programMessage.value = [data.message, data.online?.message].filter(Boolean).join('；') + (data.online?.ok ? '。请刷新线上首页核对语言；仍有旧页面时清理 PB 缓存。' : '。再次操作请关闭后重新打开，重新核对当前状态。');
  } catch (error) {
    programDone.value = true;
    programMessageType.value = 'error';
    programMessage.value = getErrorMessage(error, '未确认修复结果') + '。请关闭后重新打开检查状态，勿重复提交。';
  } finally { programBusy.value = false; }
};
const openAreaSync = () => {
  const urls = buildToolUrls(window.location.origin, import.meta.env, API_BASE_URL);
  const url = new URL('/area-sync.html', urls.ftp);
  url.searchParams.set('siteId', String(sites.activeSiteId));
  window.open(url.toString(), '_blank', 'noopener');
};
const saving = ref(false);
const dialogVisible = ref(false);
const isEdit = ref(false);
const keyword = ref('');
const currentPage = ref(1);
const pageSize = ref(20);

const areas = ref<Area[]>([]);
const selectedAreas = ref<Area[]>([]);
const formRef = ref<FormInstance>();

const form = ref({ id: 0, acode: '', name: '', domain: '' });

const rules = {
  acode: [
    { required: true, message: '请填写区域编码', trigger: 'blur' },
    { pattern: /^[a-z]{2}$/, message: '必须是两位小写字母', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请填写区域名称', trigger: 'blur' }],
};

const dialogTitle = computed(() => (isEdit.value ? '编辑区域' : '新增区域'));
const isDefault = (area: Area) => String(area.is_default) === '1';
const isSelectable = (area: Area) => !isDefault(area);
const boundCount = computed(() => areas.value.filter((area) => !!area.domain).length);

const filteredAreas = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return areas.value;
  return areas.value.filter((area) =>
    [area.acode, area.name, area.domain].some((value) => String(value || '').toLowerCase().includes(kw)),
  );
});

const pagedAreas = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredAreas.value.slice(start, start + pageSize.value);
});

const loadAreas = async () => {
  loading.value = true;
  try {
    const response = await getAreas({ page: 1, limit: 500 });
    areas.value = response.data.data;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '加载区域列表失败'));
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  isEdit.value = false;
  dialogVisible.value = true;
};

const openEdit = (area: Area) => {
  isEdit.value = true;
  form.value = { id: area.id, acode: area.acode, name: area.name, domain: area.domain || '' };
  dialogVisible.value = true;
};

const resetForm = () => {
  form.value = { id: 0, acode: '', name: '', domain: '' };
  formRef.value?.clearValidate();
};

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  saving.value = true;
  try {
    if (isEdit.value) {
      await updateArea(form.value.id, { name: form.value.name, domain: form.value.domain });
      ElMessage.success('更新成功');
    } else {
      await createArea({ acode: form.value.acode, name: form.value.name, domain: form.value.domain });
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
    await loadAreas();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, isEdit.value ? '更新失败' : '创建失败'));
  } finally {
    saving.value = false;
  }
};

const handleDelete = async (id: number) => {
  try {
    await removeArea(id);
    ElMessage.success('删除成功');
    await loadAreas();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '删除失败'));
  }
};

const handleSelectionChange = (selection: Area[]) => {
  selectedAreas.value = selection;
};

const batchDelete = async () => {
  const confirmed = await ElMessageBox.confirm(
    `确定删除选中的 ${selectedAreas.value.length} 个区域？这些语言下的内容将无法在前台访问。`,
    '批量删除',
    { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
  ).catch(() => false);
  if (!confirmed) return;

  try {
    await batchDeleteAreas(selectedAreas.value.map((area) => area.id));
    ElMessage.success('批量删除成功');
    selectedAreas.value = [];
    await loadAreas();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '批量删除失败'));
  }
};

const makeDefault = async (area: Area) => {
  try {
    const response = await setDefaultArea(area.id);
    ElMessage.success(response.data.message);
    await loadAreas();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '设置默认区域失败'));
  }
};

onMounted(loadAreas);
</script>

<style scoped>
.areas-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-bar h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.page-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.page-actions .el-button { margin-left: 0; }
.program-repair { display: flex; flex-direction: column; gap: 14px; overflow-wrap: anywhere; }
.program-repair p { margin: 0; line-height: 1.7; }

.page-bar p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.area-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.area-summary > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.area-summary span {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.area-summary strong {
  font-size: 24px;
  font-weight: 700;
}

.area-summary strong.success {
  color: var(--el-color-success);
}

.area-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.area-toolbar .el-input {
  max-width: 360px;
}

.filter-total {
  margin-left: auto;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.white-card {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.area-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.domain-text {
  font-family: var(--el-font-family-monospace, monospace);
  color: var(--el-color-primary);
}

.muted {
  color: var(--el-text-color-secondary);
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.batch-actions {
  display: flex;
  gap: 8px;
}
</style>
