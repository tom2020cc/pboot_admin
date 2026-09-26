<template>
  <div class="batch-bar">
    <strong>已选 {{ selected.length }} 项</strong>
    <el-button link :disabled="busy || !selected.length" @click="$emit('clear')"
      >取消选择</el-button
    >
    <el-dropdown :disabled="disabled" @command="setFlag">
      <el-button :disabled="disabled" :icon="Switch"
        >批量状态<el-icon class="menu-arrow"><ArrowDown /></el-icon
      ></el-button>
      <template #dropdown
        ><el-dropdown-menu>
          <el-dropdown-item
            v-for="item in flagCommands"
            :key="item.key"
            :command="item.key"
            >{{ item.label }}</el-dropdown-item
          >
        </el-dropdown-menu></template
      >
    </el-dropdown>
    <el-button :icon="Rank" :disabled="disabled" @click="open('move')"
      >移动栏目</el-button
    >
    <el-button :icon="CopyDocument" :disabled="disabled" @click="open('copy')"
      >复制产品</el-button
    >
    <el-button :icon="Upload" :disabled="disabled" @click="open('sync')"
      >同步 PB</el-button
    >
    <el-button
      :icon="Delete"
      type="danger"
      plain
      :disabled="disabled"
      @click="open('delete')"
      >批量删除</el-button
    >
    <el-button
      :icon="Check"
      :disabled="busy || blocked || !dirtyOrders.length"
      @click="open('sort')"
      >保存排序 {{ dirtyOrders.length || "" }}</el-button
    >
    <el-button v-if="results.length" link @click="resultVisible = true"
      >操作结果</el-button
    >
  </div>

  <el-dialog
    v-model="visible"
    :title="actionLabel"
    width="620px"
    class="product-batch-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="reset"
  >
    <div class="batch-scope">
      <el-tag>{{
        sites.activeSite?.name || `网站 ${sites.activeSiteId}`
      }}</el-tag
      ><el-tag type="info">{{ langName }}</el-tag
      ><strong>{{ snapshot.length }} 个产品</strong>
    </div>
    <div class="selected-preview">
      <el-tag v-for="item in snapshot.slice(0, 8)" :key="item.id" type="info"
        >#{{ item.id }} {{ item.title }}</el-tag
      ><span v-if="snapshot.length > 8"
        >及另外 {{ snapshot.length - 8 }} 项</span
      >
    </div>
    <el-alert
      v-if="action !== 'sync'"
      :closable="false"
      :type="action === 'delete' ? 'error' : 'warning'"
      :title="scopeNotice"
    />
    <el-form label-position="top" class="batch-form" :disabled="busy">
      <el-form-item
        v-if="action === 'move' || action === 'copy'"
        label="目标中文主栏目"
      >
        <el-select
          v-model="targetMenuId"
          filterable
          aria-label="批量操作目标栏目"
          style="width: 100%"
        >
          <el-option
            v-for="item in targetMenus"
            :key="item.id"
            :value="Number(item.id)"
            :label="
              formatMenuPathForLang(
                menus,
                Number(item.id),
                DEFAULT_PRODUCT_LANG,
                '3',
              )
            "
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="action === 'sync'" label="PB 同步语言范围">
        <el-radio-group v-model="allLanguages"
          ><el-radio-button :value="false"
            >当前语言：{{ langName }}</el-radio-button
          ><el-radio-button :value="true"
            >全部已翻译语言</el-radio-button
          ></el-radio-group
        >
      </el-form-item>
      <el-alert
        v-if="action === 'sync'"
        title="只同步所选产品，未选择的产品不会删除。标题或详情缺失的语言会跳过。"
        type="info"
        :closable="false"
      />
      <el-form-item v-if="action === 'delete'" label="删除范围">
        <el-checkbox v-model="deletePboot"
          >同时删除 PB 网站对应产品（全部语言）</el-checkbox
        >
      </el-form-item>
      <el-form-item
        v-if="action === 'delete'"
        :label="`输入所选数量 ${snapshot.length} 确认不可撤销的删除`"
      >
        <el-input
          v-model="deleteCount"
          aria-label="确认删除数量"
          inputmode="numeric"
          autocomplete="off"
        />
      </el-form-item>
    </el-form>
    <el-progress v-if="busy" :percentage="progress" />
    <div v-if="busy" class="progress-line">
      {{ processed }} / {{ snapshot.length
      }}<el-button link type="danger" @click="stopRequested = true">{{
        stopRequested ? "等待当前项完成" : "停止后续任务"
      }}</el-button>
    </div>
    <template #footer
      ><el-button :disabled="busy" @click="visible = false">取消</el-button
      ><el-button
        :type="action === 'delete' ? 'danger' : 'primary'"
        :loading="busy"
        :disabled="!canExecute"
        @click="execute"
        >{{ actionLabel }}</el-button
      ></template
    >
  </el-dialog>

  <el-dialog
    v-model="resultVisible"
    title="批量操作结果"
    width="900px"
    class="product-batch-dialog"
  >
    <el-alert
      :title="resultSummary"
      :closable="false"
      :type="
        results.some((item) => item.status !== 'success')
          ? 'warning'
          : 'success'
      "
    />
    <el-table :data="results" max-height="420" class="result-table">
      <el-table-column prop="id" label="ID" width="70" /><el-table-column
        prop="title"
        label="产品"
        min-width="140"
      />
      <el-table-column label="结果" width="100"
        ><template #default="{ row }"
          ><el-tag
            :type="
              row.status === 'success'
                ? 'success'
                : row.status === 'failed'
                  ? 'danger'
                  : 'warning'
            "
            >{{ statusLabels[row.status] }}</el-tag
          ></template
        ></el-table-column
      >
      <el-table-column prop="message" label="详情" min-width="300" />
    </el-table>
    <template #footer
      ><el-button @click="resultVisible = false">关闭</el-button></template
    >
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  ArrowDown,
  Check,
  CopyDocument,
  Delete,
  Rank,
  Switch,
  Upload,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import {
  batchManageProducts,
  DEFAULT_PRODUCT_LANG,
  PRODUCT_LANGUAGES,
  type ProductBatchAction,
  type ProductBatchRow,
  type ProductItem,
} from "@/api/products";
import type { MenuItem } from "@/api/menus";
import { useSitesStore } from "@/stores/sites";
import {
  filterMenusByContentLangAndModel,
  formatMenuPathForLang,
} from "@/utils/menuLanguage";
import { getErrorMessage } from "@/utils/request";

const props = defineProps<{
  selected: ProductItem[];
  products: ProductItem[];
  menus: MenuItem[];
  lang: string;
  dirtyOrders: { id: number; orderNum: number }[];
  blocked: boolean;
}>();
const emit = defineEmits<{ clear: []; changed: []; busy: [value: boolean] }>();
const sites = useSitesStore();
const statusLabels: Record<string, string> = {
  success: "成功",
  partial: "部分完成",
  failed: "失败",
  uncertain: "待核对",
};
const visible = ref(false),
  resultVisible = ref(false),
  busy = ref(false),
  stopRequested = ref(false);
const action = ref<ProductBatchAction>("show"),
  value = ref(true),
  allLanguages = ref(false),
  deletePboot = ref(false),
  deleteCount = ref("");
const targetMenuId = ref<number>(),
  snapshot = ref<ProductItem[]>([]),
  snapshotOrders = ref<{ id: number; orderNum: number }[]>([]);
const results = ref<ProductBatchRow[]>([]),
  processed = ref(0),
  resultTotal = ref(0);
let alive = true,
  operationSiteId = 0,
  operationLang = "";
const labels = {
  show: "保存显示状态",
  top: "保存置顶状态",
  recommend: "保存推荐状态",
  sort: "保存排序",
  move: "移动所选产品",
  copy: "复制所选产品",
  delete: "删除所选产品",
  sync: "同步所选产品到 PB",
};
const actionLabel = computed(() =>
  action.value === "show"
    ? value.value
      ? "显示所选产品"
      : "隐藏所选产品"
    : action.value === "top"
      ? value.value
        ? "置顶所选产品"
        : "取消所选置顶"
      : action.value === "recommend"
        ? value.value
          ? "推荐所选产品"
          : "取消所选推荐"
        : labels[action.value],
);
const langName = computed(
  () =>
    PRODUCT_LANGUAGES.find((item) => item.code === props.lang)?.name ||
    props.lang,
);
const targetMenus = computed(() =>
  filterMenusByContentLangAndModel(props.menus, DEFAULT_PRODUCT_LANG, "3"),
);
const disabled = computed(
  () => busy.value || props.blocked || !props.selected.length,
);
const progress = computed(() =>
  snapshot.value.length
    ? Math.round((processed.value / snapshot.value.length) * 100)
    : 0,
);
const scopeNotice = computed(() =>
  action.value === "delete"
    ? "将删除所选产品及后台全部译文，无法撤销。图片文件不删除。"
    : action.value === "copy"
      ? "复制产品及全部译文，创建隐藏副本和独立 URL；不会自动发布到 PB。"
      : "栏目、状态和排序为产品级设置，所有语言共用。本次只保存后台，PB 网站需另行同步。",
);
const canExecute = computed(
  () =>
    !busy.value &&
    snapshot.value.length > 0 &&
    snapshot.value.length <= 100 &&
    (!["move", "copy"].includes(action.value) || Boolean(targetMenuId.value)) &&
    (action.value !== "delete" ||
      deleteCount.value.trim() === String(snapshot.value.length)),
);
const flagCommands = [
  { key: "show:1", label: "显示" },
  { key: "show:0", label: "隐藏" },
  { key: "top:1", label: "置顶" },
  { key: "top:0", label: "取消置顶" },
  { key: "recommend:1", label: "推荐" },
  { key: "recommend:0", label: "取消推荐" },
];
const resultSummary = computed(
  () =>
    `已处理 ${results.value.length}/${resultTotal.value}；成功 ${results.value.filter((item) => item.status === "success").length}，部分完成 ${results.value.filter((item) => item.status === "partial").length}，失败 ${results.value.filter((item) => item.status === "failed").length}，待核对 ${results.value.filter((item) => item.status === "uncertain").length}；未执行 ${resultTotal.value - results.value.length}`,
);
function open(next: ProductBatchAction, rows = props.selected) {
  if (busy.value || props.blocked) return;
  action.value = next;
  snapshotOrders.value = props.dirtyOrders.map((item) => ({ ...item }));
  snapshot.value = (
    next === "sort"
      ? props.products.filter((item) =>
          snapshotOrders.value.some((order) => order.id === item.id),
        )
      : rows
  ).map((item) => ({ ...item }));
  if (snapshot.value.length > 100) {
    ElMessage.warning("单次最多操作 100 个产品，请缩小筛选范围");
    return;
  }
  operationSiteId = sites.activeSiteId;
  operationLang = props.lang;
  deletePboot.value = false;
  allLanguages.value = false;
  deleteCount.value = "";
  targetMenuId.value = undefined;
  visible.value = true;
}
function setFlag(command: string) {
  const [next, flag] = command.split(":");
  value.value = flag === "1";
  open(next as ProductBatchAction);
}
function editFlag(
  row: ProductItem,
  field: "show" | "top" | "recommend",
  enabled: boolean,
) {
  value.value = enabled;
  open(field, [row]);
}
function reset() {
  if (!busy.value) deleteCount.value = "";
}
async function execute() {
  if (
    !canExecute.value ||
    operationSiteId !== sites.activeSiteId ||
    operationLang !== props.lang
  )
    return;
  busy.value = true;
  emit("busy", true);
  stopRequested.value = false;
  results.value = [];
  processed.value = 0;
  resultTotal.value = snapshot.value.length;
  try {
    // One item per request gives bounded progress and never silently retries a copy/delete.
    for (const item of snapshot.value) {
      if (
        stopRequested.value ||
        !alive ||
        sites.activeSiteId !== operationSiteId
      )
        break;
      try {
        const res = await batchManageProducts(
          {
            action: action.value,
            ids: [item.id],
            confirmed: true,
            value: value.value,
            menuId: targetMenuId.value,
            lang: operationLang,
            allLanguages: allLanguages.value,
            deletePboot: deletePboot.value,
            ...(action.value === "sort"
              ? {
                  orders: snapshotOrders.value.filter(
                    (order) => order.id === item.id,
                  ),
                }
              : {}),
          },
          operationSiteId,
        );
        results.value.push(...res.data.results);
      } catch (error) {
        results.value.push({
          id: item.id,
          title: item.title,
          status: "uncertain",
          message:
            getErrorMessage(error, "请求失败") + "；请刷新核对，未自动重试",
        });
        stopRequested.value = true;
      }
      processed.value++;
    }
    if (alive) {
      visible.value = false;
      resultVisible.value = true;
      emit("changed");
    }
  } finally {
    busy.value = false;
    emit("busy", false);
  }
}
onBeforeUnmount(() => {
  alive = false;
  stopRequested.value = true;
});
defineExpose({ editFlag });
</script>

<style scoped>
.batch-bar,
.batch-scope,
.selected-preview,
.progress-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.batch-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--el-bg-color);
  border-block: 1px solid var(--el-border-color-light);
  padding: 12px 8px;
}
.batch-bar .el-button {
  margin-left: 0;
}
.menu-arrow {
  margin-left: 6px;
}
.batch-scope {
  margin-bottom: 14px;
}
.selected-preview {
  margin-bottom: 16px;
  max-height: 130px;
  overflow: auto;
}
.selected-preview .el-tag {
  max-width: 100%;
  height: auto;
  white-space: normal;
  overflow-wrap: anywhere;
}
.batch-form {
  margin-top: 16px;
}
.progress-line {
  justify-content: space-between;
  margin-top: 12px;
}
.result-table {
  margin-top: 16px;
}
@media (max-width: 650px) {
  .batch-bar {
    gap: 8px;
  }
  .batch-bar strong {
    width: 100%;
  }
}
</style>
