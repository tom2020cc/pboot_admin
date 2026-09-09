<template>
  <section class="page quotation-page">
    <div class="page-bar">
      <div>
        <h2>{{ workspaceView === "editor" ? "报价单生成" : "报价单列表" }}</h2>
        <p v-if="workspaceView === 'editor'">
          中文产品报价 · {{ quote.quotationNo }} · {{ currentQuotationId ? `已保存 #${currentQuotationId}` : "尚未保存" }}
        </p>
        <p v-else>管理已经保存的报价单，可继续编辑、预览、下载或删除。</p>
      </div>
      <div v-if="workspaceView === 'editor'" class="page-actions">
        <el-button :icon="RefreshLeft" @click="resetDraft">新建报价</el-button>
        <el-button @click="showQuotationList">报价单列表</el-button>
        <el-button type="success" :icon="Check" :loading="savingQuotation" @click="saveQuotation">
          {{ currentQuotationId ? "保存修改" : "保存报价单" }}
        </el-button>
        <el-button :icon="View" @click="openWebDialog">打开网页</el-button>
        <el-button type="primary" :icon="Download" :disabled="!quote.items.length" @click="downloadHtml">生成 HTML</el-button>
      </div>
      <div v-else class="page-actions">
        <el-button :icon="RefreshLeft" :loading="loadingQuotations" @click="loadQuotationList">刷新列表</el-button>
        <el-button v-if="currentQuotationId" @click="workspaceView = 'editor'">继续编辑</el-button>
        <el-button type="primary" @click="createNewQuotation">新建报价</el-button>
      </div>
    </div>

    <div class="quotation-view-tabs">
      <button type="button" :class="{ active: workspaceView === 'editor' }" @click="workspaceView = 'editor'">编辑报价</button>
      <button type="button" :class="{ active: workspaceView === 'list' }" @click="showQuotationList">报价单列表</button>
    </div>

    <section v-if="workspaceView === 'list'" class="quotation-list-panel">
      <div class="list-summary">
        <div><span>已保存报价单</span><strong>{{ quotationRecords.length }}</strong></div>
        <div><span>当前编辑</span><strong>{{ currentQuotationId ? quote.quotationNo : "新报价" }}</strong></div>
        <div><span>最近更新</span><strong>{{ latestQuotationTime }}</strong></div>
      </div>
      <div class="list-filter">
        <el-input v-model="quotationSearch" clearable placeholder="搜索报价单编号、客户公司或联系人" @keyup.enter="loadQuotationList" />
        <el-button type="primary" @click="loadQuotationList">查询</el-button>
      </div>
      <el-table v-loading="loadingQuotations" :data="quotationRecords" border stripe class="quotation-table" empty-text="暂无已保存报价单">
        <el-table-column prop="quotationNo" label="报价单编号" min-width="170" />
        <el-table-column prop="customerCompany" label="客户公司" min-width="190">
          <template #default="{ row }">{{ row.customerCompany || "-" }}</template>
        </el-table-column>
        <el-table-column prop="customerContact" label="联系人" min-width="120">
          <template #default="{ row }">{{ row.customerContact || "-" }}</template>
        </el-table-column>
        <el-table-column prop="quotationDate" label="报价日期" width="120" align="center" />
        <el-table-column prop="itemCount" label="产品" width="80" align="center">
          <template #default="{ row }">{{ row.itemCount }} 项</template>
        </el-table-column>
        <el-table-column label="报价总额" min-width="150" align="right">
          <template #default="{ row }"><strong class="record-total">{{ formatMoney(row.total, row.currency) }}</strong></template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.updateTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="300" align="center">
          <template #default="{ row }">
            <el-button type="info" link @click="previewSavedQuotation(row)">预览</el-button>
            <el-button type="primary" link @click="editSavedQuotation(row)">编辑</el-button>
            <el-button type="success" link @click="downloadSavedQuotation(row)">下载 HTML</el-button>
            <el-button type="danger" link @click="deleteSavedQuotation(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div v-else class="quotation-workbench">
      <div class="quotation-editor">
        <section class="editor-section">
          <div class="section-heading">
            <div><span>01</span><h3>报价信息</h3></div>
            <strong>{{ formatMoney(grandTotal, quote.currency) }}</strong>
          </div>
          <el-form label-position="top" class="compact-form">
            <div class="form-grid two">
              <el-form-item label="报价单编号"><el-input v-model="quote.quotationNo" /></el-form-item>
              <el-form-item label="报价日期"><el-date-picker v-model="quote.quotationDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
              <el-form-item label="客户公司"><el-input v-model="quote.customerCompany" placeholder="填写客户公司" /></el-form-item>
              <el-form-item label="客户联系人"><el-input v-model="quote.customerContact" placeholder="填写联系人" /></el-form-item>
              <el-form-item label="报价负责人"><el-input v-model="quote.salesName" placeholder="填写业务负责人" /></el-form-item>
              <el-form-item label="隶属部门"><el-input v-model="quote.salesDepartment" placeholder="例如：钻机生产技术部" /></el-form-item>
              <el-form-item label="职位"><el-input v-model="quote.salesPosition" placeholder="例如：设备应用工程师" /></el-form-item>
              <el-form-item label="联系电话"><el-input v-model="quote.phone" placeholder="手机 / WhatsApp" /></el-form-item>
              <el-form-item label="WhatsApp"><el-input v-model="quote.whatsapp" placeholder="例如：+86 190 0000 0000" /></el-form-item>
              <el-form-item label="微信"><el-input v-model="quote.wechat" placeholder="填写微信号" /></el-form-item>
              <el-form-item label="联系邮箱"><el-input v-model="quote.email" placeholder="业务邮箱" /></el-form-item>
              <el-form-item label="产品类型"><el-input v-model="quote.productCategory" placeholder="例如：车载式水井钻机" /></el-form-item>
              <el-form-item label="是否特殊定制">
                <el-select v-model="quote.customized"><el-option label="否" value="否" /><el-option label="是" value="是" /></el-select>
              </el-form-item>
              <el-form-item label="原产国"><el-input v-model="quote.originCountry" /></el-form-item>
              <el-form-item label="报价有效期">
                <el-input-number v-model="quote.validityDays" :min="1" :max="365" controls-position="right" />
              </el-form-item>
            </div>
          </el-form>
        </section>

        <section class="editor-section">
          <div class="section-heading">
            <div><span>02</span><h3>选择产品</h3></div>
            <strong>{{ quote.items.length }} 项</strong>
          </div>
          <el-select
            v-model="selectedProductIds"
            v-loading="loadingProducts"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            class="product-picker"
            placeholder="搜索并选择产品"
            @change="applyProductSelection"
          >
            <el-option v-for="product in products" :key="product.id" :label="productOptionLabel(product)" :value="product.id">
              <div class="product-option">
                <el-image :src="getUploadUrl(product.thumbnail)" fit="contain" />
                <span>{{ productOptionLabel(product) }}</span>
                <small>#{{ product.id }}</small>
              </div>
            </el-option>
          </el-select>

          <div v-if="quote.items.length" class="line-list">
            <article v-for="(item, index) in quote.items" :key="item.id" class="line-editor">
              <div class="line-main">
                <el-image :src="getUploadUrl(primaryLineImage(item))" fit="contain" class="line-image">
                  <template #error><div class="image-fallback">无图</div></template>
                </el-image>
                <div class="line-title">
                  <span>产品 {{ index + 1 }}<template v-if="item.categoryName"> · {{ item.categoryName }}</template></span>
                  <el-input v-model="item.title" />
                </div>
                <div class="line-total">
                  <span>小计</span>
                  <strong>{{ formatMoney(lineTotal(item), quote.currency) }}</strong>
                </div>
                <div class="line-tools">
                  <el-tooltip content="上移" placement="top"><el-button circle :icon="ArrowUp" :disabled="index === 0" @click="moveLine(index, -1)" /></el-tooltip>
                  <el-tooltip content="下移" placement="top"><el-button circle :icon="ArrowDown" :disabled="index === quote.items.length - 1" @click="moveLine(index, 1)" /></el-tooltip>
                  <el-tooltip content="移除" placement="top"><el-button circle type="danger" plain :icon="Delete" @click="removeLine(index)" /></el-tooltip>
                </div>
              </div>
              <div class="line-pricing">
                <label><span>数量</span><el-input-number v-model="item.quantity" :min="0" :precision="0" controls-position="right" /></label>
                <label><span>单价（{{ quote.currency }}）</span><el-input-number v-model="item.unitPrice" :min="0" :precision="2" :step="100" controls-position="right" /></label>
                <div class="line-image-field">
                  <div class="image-picker-heading">
                    <span>展示图片</span>
                    <small>已选 {{ item.images?.length || 0 }}/3</small>
                  </div>
                  <div class="line-image-picker">
                    <button
                      v-for="image in imageOptions(item.productId)"
                      :key="image.value"
                      type="button"
                      class="image-choice"
                      :class="{ 'is-selected': isLineImageSelected(item, image.value) }"
                      :aria-pressed="isLineImageSelected(item, image.value)"
                      :title="isLineImageSelected(item, image.value) ? `取消${image.label}` : `选择${image.label}`"
                      @click="toggleLineImage(item, image.value)"
                    >
                      <el-image :src="getUploadUrl(image.value)" fit="contain" />
                      <span class="image-choice-label">{{ image.label }}</span>
                      <span v-if="selectedLineImageIndex(item, image.value) >= 0" class="image-choice-order">
                        {{ selectedLineImageIndex(item, image.value) + 1 }}
                      </span>
                    </button>
                  </div>
                  <small v-if="(item.images?.length || 0) >= 3" class="image-picker-limit">点击已选图片可取消或更换</small>
                </div>
              </div>
              <details class="line-details">
                <summary>技术参数（{{ parseSpecificationText(item.specText).length }} 条）</summary>
                <div class="details-body">
                  <el-input v-model="item.specText" type="textarea" :rows="10" resize="vertical" />
                  <el-input v-model="item.remark" type="textarea" :rows="2" resize="vertical" placeholder="该产品的报价备注" />
                </div>
              </details>
            </article>
          </div>
          <el-empty v-else :image-size="72" description="尚未选择产品" />
        </section>

        <section class="editor-section">
          <div class="section-heading"><div><span>03</span><h3>商务与运输</h3></div></div>
          <el-form label-position="top" class="compact-form">
            <div class="form-grid three">
              <el-form-item label="币种"><el-select v-model="quote.currency"><el-option v-for="currency in currencies" :key="currency" :label="currency" :value="currency" /></el-select></el-form-item>
              <el-form-item label="交货条款"><el-select v-model="quote.incoterm" allow-create filterable><el-option v-for="term in incoterms" :key="term" :label="term" :value="term" /></el-select></el-form-item>
              <el-form-item label="质保"><el-input v-model="quote.warranty" /></el-form-item>
              <el-form-item label="装货港"><el-input v-model="quote.loadingPort" /></el-form-item>
              <el-form-item label="目的港"><el-input v-model="quote.destinationPort" /></el-form-item>
              <el-form-item label="运输方式"><el-select v-model="quote.transportMode" allow-create filterable><el-option v-for="mode in transportModes" :key="mode" :label="mode" :value="mode" /></el-select></el-form-item>
              <el-form-item label="运费"><el-input-number v-model="quote.freight" :min="0" :precision="2" :step="100" controls-position="right" /></el-form-item>
              <el-form-item label="定金比例"><el-input-number v-model="quote.depositPercent" :min="0" :max="100" :precision="0" controls-position="right" /></el-form-item>
              <el-form-item label="付款方式"><el-input v-model="quote.paymentTerms" /></el-form-item>
            </div>
            <el-form-item label="报价说明"><el-input v-model="quote.notes" type="textarea" :rows="3" resize="vertical" /></el-form-item>
          </el-form>
        </section>

        <details class="editor-section company-settings">
          <summary>公司抬头设置</summary>
          <el-form label-position="top" class="compact-form company-settings-body">
            <div class="logo-setting">
              <div class="logo-preview">
                <el-image :src="getUploadUrl(quote.logoUrl)" fit="contain">
                  <template #error><div class="image-fallback">Logo</div></template>
                </el-image>
              </div>
              <el-form-item label="公司 Logo 地址">
                <el-input v-model="quote.logoUrl" placeholder="读取当前网站的 Logo 地址，也可以手动修改" />
              </el-form-item>
              <el-button :disabled="!defaultLogoUrl" @click="quote.logoUrl = defaultLogoUrl">使用网站 Logo</el-button>
              <el-button type="primary" plain :loading="loadingSiteProfile" @click="reloadCurrentSiteProfile">重新读取当前网站</el-button>
            </div>
            <div class="form-grid two">
              <el-form-item label="公司名称"><el-input v-model="quote.companyName" /></el-form-item>
              <el-form-item label="公司副标题"><el-input v-model="quote.companySubtitle" /></el-form-item>
              <el-form-item label="网站"><el-input v-model="quote.website" /></el-form-item>
              <el-form-item label="图片网址前缀"><el-input v-model="quote.assetBaseUrl" /></el-form-item>
            </div>
          </el-form>
        </details>
      </div>

      <aside class="quote-preview-pane">
        <div class="preview-toolbar">
          <div><strong>网页预览</strong><span>中文保存稿</span></div>
          <div><span>产品小计 {{ formatMoney(subtotal, quote.currency) }}</span><strong>总额 {{ formatMoney(grandTotal, quote.currency) }}</strong></div>
        </div>
        <div class="quote-preview-frame" v-html="previewHtml" />
      </aside>
    </div>

    <el-dialog v-model="savedPreviewVisible" :title="savedPreviewRecord?.quotationNo || '报价单预览'" width="96vw" top="2vh" destroy-on-close class="saved-preview-dialog">
      <div class="saved-preview-frame" v-html="savedPreviewHtml" />
      <template #footer>
        <el-button @click="savedPreviewVisible = false">关闭</el-button>
        <el-button v-if="savedPreviewRecord" type="primary" @click="downloadSavedQuotation(savedPreviewRecord)">下载 HTML</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="webDialogVisible" title="网页、HTML 与 PDF" width="min(680px, 94vw)" class="web-output-dialog">
      <el-form label-position="top">
        <el-form-item label="网页语言">
          <el-select v-model="targetLanguage" :disabled="translating">
            <el-option v-for="language in availableLanguages" :key="language.code" :label="language.name" :value="language.code" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="targetLanguage !== 'zh-CN'" label="翻译模型">
          <el-select v-model="selectedTranslationModel" filterable :loading="loadingTranslationModels" :disabled="translating">
            <el-option
              v-for="model in selectableTranslationModels"
              :key="model.value"
              :label="model.displayLabel || model.label"
              :value="model.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="translating" @click="webDialogVisible = false">取消</el-button>
        <el-button :icon="Download" :loading="translating && webOutputAction === 'download'" :disabled="translating" @click="downloadWebQuotation">
          {{ targetLanguage === "zh-CN" ? "下载中文 HTML" : "翻译并下载 HTML" }}
        </el-button>
        <el-button :icon="Printer" :loading="translating && webOutputAction === 'pdf'" :disabled="translating" @click="exportPdfQuotation">
          {{ targetLanguage === "zh-CN" ? "导出中文 PDF" : "翻译并导出 PDF" }}
        </el-button>
        <el-button type="primary" :icon="targetLanguage === 'zh-CN' ? View : MagicStick" :loading="translating && webOutputAction === 'open'" :disabled="translating" @click="generateWebQuotation">
          {{ targetLanguage === "zh-CN" ? "打开中文网页" : "翻译并打开网页" }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, ArrowUp, Check, Delete, Download, MagicStick, Printer, RefreshLeft, View } from "@element-plus/icons-vue";
import {
  getProductList,
  getProductTranslationModels,
  PRODUCT_LANGUAGES,
  translateProductDraft,
  type ProductItem,
} from "@/api/products";
import type { TranslationModel } from "@/api/news";
import { getAll as getAllMenus, type MenuItem } from "@/api/menus";
import { getCurrentSiteProfile, type SiteBusinessProfile } from "@/api/sites";
import {
  createQuotation,
  getNextQuotationNumber,
  getQuotationById,
  getQuotationList,
  removeQuotation,
  updateQuotation,
  type QuotationPayload,
  type QuotationRecord,
} from "@/api/quotations";
import { getUploadUrl } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import {
  buildQuotationHtml,
  buildQuotationPreviewHtml,
  createDefaultQuotation,
  createQuotationLine,
  formatMoney,
  formatSpecificationText,
  parseSpecificationText,
  quotationHtmlFileName,
  quotationSubtotal,
  quotationTotal,
  type QuotationDraft,
  type QuotationLanguageCode,
  type QuotationLine,
} from "@/utils/quotation";
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";
import { getActiveSiteId } from "@/utils/siteSelection";
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from "@/utils/translationModelPreference";

const LEGACY_DRAFT_KEY = "pboot-quotation-draft-v1";
const availableLanguages = useAvailableLanguages();
const LEGACY_CURRENT_ID_KEY = "pboot-quotation-current-id-v1";
const siteStorageKey = (key: string) => `${key}:site:${getActiveSiteId() || 0}`;
const draftStorageKey = () => siteStorageKey(LEGACY_DRAFT_KEY);
const currentIdStorageKey = () => siteStorageKey(LEGACY_CURRENT_ID_KEY);
const quote = reactive<QuotationDraft>(createDefaultQuotation());
const currentSiteProfile = ref<SiteBusinessProfile | null>(null);
const loadingSiteProfile = ref(false);
const restoredFromLegacyDraft = ref(false);
const defaultLogoUrl = computed(() => currentSiteProfile.value?.logoUrl || "");
const products = ref<ProductItem[]>([]);
const menus = ref<MenuItem[]>([]);
const selectedProductIds = ref<number[]>([]);
const loadingProducts = ref(false);
const workspaceView = ref<"editor" | "list">("editor");
const currentQuotationId = ref<number | null>(null);
const savingQuotation = ref(false);
const loadingQuotations = ref(false);
const quotationRecords = ref<QuotationRecord[]>([]);
const quotationSearch = ref("");
const savedPreviewVisible = ref(false);
const savedPreviewRecord = ref<QuotationRecord | null>(null);
const webDialogVisible = ref(false);
const translationModels = ref<TranslationModel[]>([]);
const selectableTranslationModels = computed(() =>
  translationModels.value.filter((model) => model.available && model.operational !== false),
);
const loadingTranslationModels = ref(false);
const translating = ref(false);
const webOutputAction = ref<"" | "open" | "download" | "pdf">("");
const targetLanguage = ref<QuotationLanguageCode>("zh-CN");
const selectedTranslationModel = ref("");
const currencies = ["USD", "CNY", "EUR"];
const incoterms = ["EXW", "FOB", "CIF", "CFR"];
const transportModes = ["海运", "陆运", "空运", "客户自提"];

const currentSiteAssetReference = (value: string) => {
  const source = String(value || "").trim();
  if (!/^https?:\/\//i.test(source)) return source;
  try {
    const path = decodeURIComponent(new URL(source).pathname);
    return /^\/(?:static|uploads?)\//i.test(path) ? path : source;
  } catch {
    return source;
  }
};

const localPreviewAssetUrl = (value: string) => {
  const source = String(value || "").trim();
  if (!source || /^data:|^blob:/i.test(source)) return source;
  const siteReference = currentSiteAssetReference(source);
  return siteReference === source && /^https?:\/\//i.test(source) ? source : getUploadUrl(siteReference);
};

const createLocalPreviewDraft = (source: QuotationDraft) => {
  const draft = JSON.parse(JSON.stringify(source)) as QuotationDraft;
  draft.logoUrl = localPreviewAssetUrl(draft.logoUrl);
  draft.assetBaseUrl = "";
  draft.items.forEach((item) => {
    item.image = localPreviewAssetUrl(item.image);
    item.images = (item.images || []).map(localPreviewAssetUrl);
  });
  return draft;
};

const subtotal = computed(() => quotationSubtotal(quote));
const grandTotal = computed(() => quotationTotal(quote));
const previewHtml = computed(() => buildQuotationPreviewHtml(createLocalPreviewDraft(quote)));
const savedPreviewHtml = computed(() => savedPreviewRecord.value
  ? buildQuotationPreviewHtml(createLocalPreviewDraft(savedPreviewRecord.value.data))
  : "");
const latestQuotationTime = computed(() => quotationRecords.value[0]?.updateTime
  ? formatDateTime(quotationRecords.value[0].updateTime)
  : "-");

const productMap = computed(() => new Map(products.value.map((product) => [product.id, product])));
const menuMap = computed(() => new Map(menus.value.map((menu) => [Number(menu.id), menu])));

const productCategoryName = (product: ProductItem) => String(menuMap.value.get(Number(product.menuId))?.name || "").trim();

const productOptionLabel = (product: ProductItem) => {
  const categoryName = productCategoryName(product);
  return categoryName ? `${product.title} ${categoryName}` : product.title;
};

const normalizeQuotationCategories = (draft: QuotationDraft) => {
  draft.items.forEach((item) => {
    if (String(item.categoryName || "").trim()) return;
    const product = productMap.value.get(item.productId);
    item.categoryName = product ? productCategoryName(product) : "";
  });
};

const normalizeQuotationImages = (draft: QuotationDraft) => {
  draft.items.forEach((item) => {
    const values = (Array.isArray(item.images) && item.images.length ? item.images : [item.image])
      .map((value) => String(value || "").trim())
      .filter((value, index, images) => value && images.indexOf(value) === index)
      .slice(0, 3);
    item.images = values;
    item.image = values[0] || "";
  });
};

const primaryLineImage = (item: QuotationLine) => item.images?.[0] || item.image || "";

const syncLegacyImage = (item: QuotationLine) => {
  item.images = (item.images || []).slice(0, 3);
  item.image = item.images[0] || "";
};

const selectedLineImageIndex = (item: QuotationLine, image: string) => (item.images || []).indexOf(image);

const isLineImageSelected = (item: QuotationLine, image: string) => selectedLineImageIndex(item, image) >= 0;

const toggleLineImage = (item: QuotationLine, image: string) => {
  const images = [...(item.images || [])];
  const selectedIndex = images.indexOf(image);
  if (selectedIndex >= 0) {
    images.splice(selectedIndex, 1);
  } else if (images.length >= 3) {
    ElMessage.warning("最多展示 3 张图片，请先取消一张已选图片");
    return;
  } else {
    images.push(image);
  }
  item.images = images;
  syncLegacyImage(item);
};

const applyProductSelection = (ids: number[]) => {
  const existing = new Map(quote.items.map((item) => [item.productId, item]));
  quote.items = ids.flatMap((id) => {
    const savedLine = existing.get(id);
    if (savedLine) return [savedLine];
    const product = productMap.value.get(id);
    return product ? [createQuotationLine(product, productCategoryName(product), quote.currency)] : [];
  });
  normalizeQuotationImages(quote);
  normalizeQuotationCategories(quote);
};

const imageOptions = (productId: number) => {
  const product = productMap.value.get(productId);
  if (!product) return [];
  const values = [
    { label: "产品大图", value: product.largeImage },
    { label: "缩略图", value: product.thumbnail },
    ...(product.carouselImages || []).map((value, index) => ({ label: `轮播图 ${index + 1}`, value })),
  ].filter((item) => item.value);
  return values.filter((item, index) => values.findIndex((candidate) => candidate.value === item.value) === index);
};

const lineTotal = (item: QuotationLine) => Number(item.quantity || 0) * Number(item.unitPrice || 0);

const moveLine = (index: number, offset: number) => {
  const next = index + offset;
  if (next < 0 || next >= quote.items.length) return;
  const [item] = quote.items.splice(index, 1);
  quote.items.splice(next, 0, item);
  selectedProductIds.value = quote.items.map((line) => line.productId);
};

const removeLine = (index: number) => {
  quote.items.splice(index, 1);
  selectedProductIds.value = quote.items.map((line) => line.productId);
};

const cloneDraft = (value: QuotationDraft): QuotationDraft => JSON.parse(JSON.stringify(value));

const applyCurrentSiteProfile = (draft: QuotationDraft, overwrite = false) => {
  const profile = currentSiteProfile.value;
  if (!profile) return;
  const use = (current: string, next: string) => overwrite ? next : current || next;
  draft.companyName = use(draft.companyName, profile.companyName);
  draft.companySubtitle = use(draft.companySubtitle, profile.companySubtitle);
  draft.logoUrl = use(draft.logoUrl, profile.logoUrl);
  draft.website = use(draft.website, profile.website);
  draft.assetBaseUrl = use(draft.assetBaseUrl, profile.assetBaseUrl);
  draft.salesName = use(draft.salesName, profile.contactName);
  draft.phone = use(draft.phone, profile.phone);
  draft.whatsapp = use(draft.whatsapp, profile.whatsapp);
  draft.wechat = use(draft.wechat, profile.wechat);
  draft.email = use(draft.email, profile.email);
  if (overwrite) {
    draft.items.forEach((item) => {
      item.image = currentSiteAssetReference(item.image);
      item.images = (item.images || []).map(currentSiteAssetReference);
    });
  }
};

const loadCurrentSiteProfile = async () => {
  loadingSiteProfile.value = true;
  try {
    currentSiteProfile.value = (await getCurrentSiteProfile()).data;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "当前网站资料读取失败"));
  } finally {
    loadingSiteProfile.value = false;
  }
};

const reloadCurrentSiteProfile = async () => {
  await loadCurrentSiteProfile();
  if (!currentSiteProfile.value) return;
  applyCurrentSiteProfile(quote, true);
  ElMessage.success(`已读取当前网站：${currentSiteProfile.value.siteName}`);
};

const loadTranslationModels = async () => {
  loadingTranslationModels.value = true;
  try {
    const result = await getProductTranslationModels();
    translationModels.value = result.data;
    selectedTranslationModel.value = resolvePreferredTranslationModel(translationModels.value, selectedTranslationModel.value);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "翻译模型加载失败"));
  } finally {
    loadingTranslationModels.value = false;
  }
};

watch(selectedTranslationModel, (value) => savePreferredTranslationModel(value));

const buildTranslatedQuotation = async () => {
  const translated = cloneDraft(quote);
  translated.language = targetLanguage.value;
  const slots: Array<{ source: string; apply: (value: string) => void }> = [];
  const translatedSpecGroups: Array<{ line: QuotationLine; specs: ReturnType<typeof parseSpecificationText> }> = [];
  const addSlot = (source: string, apply: (value: string) => void) => {
    const text = String(source || "").trim();
    if (text) slots.push({ source: text, apply });
  };

  addSlot(quote.salesDepartment, (value) => { translated.salesDepartment = value; });
  addSlot(quote.salesPosition, (value) => { translated.salesPosition = value; });
  addSlot(quote.productCategory, (value) => { translated.productCategory = value; });
  addSlot(quote.customized, (value) => { translated.customized = value; });
  addSlot(quote.originCountry, (value) => { translated.originCountry = value; });
  addSlot(quote.warranty, (value) => { translated.warranty = value; });
  addSlot(quote.paymentTerms, (value) => { translated.paymentTerms = value; });
  addSlot(quote.loadingPort, (value) => { translated.loadingPort = value; });
  addSlot(quote.destinationPort, (value) => { translated.destinationPort = value; });
  addSlot(quote.transportMode, (value) => { translated.transportMode = value; });

  quote.items.forEach((sourceLine, index) => {
    const targetLine = translated.items[index];
    addSlot(sourceLine.title, (value) => { targetLine.title = value; });
    addSlot(sourceLine.categoryName || "", (value) => { targetLine.categoryName = value; });
    addSlot(sourceLine.remark, (value) => { targetLine.remark = value; });
    const specs = parseSpecificationText(sourceLine.specText).map((item) => ({ ...item }));
    translatedSpecGroups.push({ line: targetLine, specs });
    specs.forEach((spec) => {
      addSlot(spec.group, (value) => { spec.group = value; });
      addSlot(spec.name, (value) => { spec.name = value; });
      addSlot(spec.value, (value) => { spec.value = value; });
    });
  });

  const result = await translateProductDraft({
    sourceLang: "zh-CN",
    targetLang: targetLanguage.value,
    model: selectedTranslationModel.value,
    title: quote.title,
    subtitle: quote.companyName,
    keywords: "",
    summary: quote.companySubtitle,
    content: quote.notes,
    carouselTitles: slots.map((slot) => slot.source),
  });
  const output = result.data;
  if ((output.carouselTitles || []).length !== slots.length) {
    throw new Error(`译文校验失败：应返回 ${slots.length} 项，实际返回 ${output.carouselTitles?.length || 0} 项`);
  }
  translated.title = output.title || quote.title;
  translated.companyName = output.subtitle || quote.companyName;
  translated.companySubtitle = output.summary || quote.companySubtitle;
  translated.notes = output.content || quote.notes;
  output.carouselTitles.forEach((value, index) => slots[index].apply(value || slots[index].source));
  translatedSpecGroups.forEach(({ line, specs }) => { line.specText = formatSpecificationText(specs); });
  return translated;
};

const persistDraft = () => {
  localStorage.setItem(draftStorageKey(), JSON.stringify(quote));
  if (currentQuotationId.value) localStorage.setItem(currentIdStorageKey(), String(currentQuotationId.value));
  else localStorage.removeItem(currentIdStorageKey());
};

const restoreDraft = () => {
  try {
    const scopedValue = localStorage.getItem(draftStorageKey());
    const legacyValue = scopedValue ? null : localStorage.getItem(LEGACY_DRAFT_KEY);
    const saved = JSON.parse(scopedValue || legacyValue || "null") as QuotationDraft | null;
    if (saved?.version !== 1) return false;
    restoredFromLegacyDraft.value = Boolean(legacyValue);
    Object.assign(quote, createDefaultQuotation(), saved);
    quote.language = "zh-CN";
    normalizeQuotationImages(quote);
    const savedId = Number(scopedValue ? localStorage.getItem(currentIdStorageKey()) || 0 : 0);
    currentQuotationId.value = Number.isInteger(savedId) && savedId > 0 ? savedId : null;
    if (legacyValue) {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
      localStorage.removeItem(LEGACY_CURRENT_ID_KEY);
    }
    return true;
  } catch (_error) {
    localStorage.removeItem(draftStorageKey());
    localStorage.removeItem(currentIdStorageKey());
    return false;
  }
};

const resetDraft = async () => {
  try {
    await ElMessageBox.confirm("新建报价会清空当前未导出的内容，继续吗？", "新建报价", { type: "warning" });
  } catch (_error) {
    return false;
  }
  Object.assign(quote, createDefaultQuotation());
  applyCurrentSiteProfile(quote, true);
  currentQuotationId.value = null;
  selectedProductIds.value = [];
  localStorage.removeItem(draftStorageKey());
  localStorage.removeItem(currentIdStorageKey());
  await applyNextQuotationNumber();
  workspaceView.value = "editor";
  return true;
};

const createNewQuotation = async () => {
  await resetDraft();
};

const applyNextQuotationNumber = async () => {
  try {
    const result = await getNextQuotationNumber(quote.quotationDate);
    quote.quotationNo = result.data.quotationNo;
  } catch (_error) {
    // Keep the local fallback number when the backend is temporarily unavailable.
  }
};

const quotationPayload = (): QuotationPayload => {
  const chineseDraft = cloneDraft(quote);
  chineseDraft.language = "zh-CN";
  return {
    quotationNo: quote.quotationNo.trim(),
    customerCompany: quote.customerCompany.trim(),
    customerContact: quote.customerContact.trim(),
    currency: quote.currency,
    total: grandTotal.value,
    itemCount: quote.items.length,
    quotationDate: quote.quotationDate,
    data: chineseDraft,
  };
};

const loadQuotationList = async () => {
  loadingQuotations.value = true;
  try {
    const result = await getQuotationList(quotationSearch.value);
    quotationRecords.value = result.data;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "报价单列表加载失败"));
  } finally {
    loadingQuotations.value = false;
  }
};

const showQuotationList = () => {
  workspaceView.value = "list";
  loadQuotationList();
};

const saveQuotation = async () => {
  if (!quote.quotationNo.trim()) {
    ElMessage.warning("请填写报价单编号");
    return;
  }
  if (!quote.items.length) {
    ElMessage.warning("请至少选择一个产品");
    return;
  }
  savingQuotation.value = true;
  try {
    const wasUpdate = Boolean(currentQuotationId.value);
    const payload = quotationPayload();
    const result = currentQuotationId.value
      ? await updateQuotation(currentQuotationId.value, payload)
      : await createQuotation(payload);
    currentQuotationId.value = result.data.id;
    Object.assign(quote, createDefaultQuotation(), result.data.data);
    quote.language = "zh-CN";
    normalizeQuotationImages(quote);
    persistDraft();
    await loadQuotationList();
    ElMessage.success(wasUpdate ? "报价单修改已保存" : "报价单已创建");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "报价单保存失败"));
  } finally {
    savingQuotation.value = false;
  }
};

const readSavedQuotation = async (id: number) => {
  const result = await getQuotationById(id);
  return result.data;
};

const previewSavedQuotation = async (record: QuotationRecord) => {
  try {
    savedPreviewRecord.value = await readSavedQuotation(record.id);
    normalizeQuotationCategories(savedPreviewRecord.value.data);
    savedPreviewVisible.value = true;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "报价单读取失败"));
  }
};

const editSavedQuotation = async (record: QuotationRecord) => {
  try {
    const saved = await readSavedQuotation(record.id);
    Object.assign(quote, createDefaultQuotation(), cloneDraft(saved.data));
    quote.language = "zh-CN";
    normalizeQuotationImages(quote);
    normalizeQuotationCategories(quote);
    currentQuotationId.value = saved.id;
    selectedProductIds.value = quote.items.map((item) => item.productId).filter((id) => productMap.value.has(id));
    workspaceView.value = "editor";
    persistDraft();
    ElMessage.success(`已打开 ${saved.quotationNo}`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "报价单读取失败"));
  }
};

const downloadDraftHtml = (draft: QuotationDraft) => {
  const blob = new Blob([buildQuotationHtml(draft)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = quotationHtmlFileName(draft);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const downloadSavedQuotation = (record: QuotationRecord) => {
  const draft = cloneDraft(record.data);
  normalizeQuotationCategories(draft);
  downloadDraftHtml(draft);
  ElMessage.success(`${record.quotationNo} HTML 已生成`);
};

const deleteSavedQuotation = async (record: QuotationRecord) => {
  try {
    await ElMessageBox.confirm(`确定删除报价单 ${record.quotationNo} 吗？`, "删除报价单", { type: "warning" });
  } catch (_error) {
    return;
  }
  try {
    await removeQuotation(record.id);
    if (currentQuotationId.value === record.id) {
      currentQuotationId.value = null;
      persistDraft();
    }
    if (savedPreviewRecord.value?.id === record.id) savedPreviewVisible.value = false;
    await loadQuotationList();
    ElMessage.success("报价单已删除");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "报价单删除失败"));
  }
};

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

const loadProducts = async () => {
  loadingProducts.value = true;
  try {
    const [result, menuResult] = await Promise.all([getProductList(undefined, "zh-CN"), getAllMenus()]);
    products.value = result.data;
    menus.value = menuResult.data;
    normalizeQuotationCategories(quote);
    selectedProductIds.value = quote.items.map((item) => item.productId).filter((id) => productMap.value.has(id));
    if (!quote.items.length && products.value.length) {
      const firstProduct = products.value[0];
      quote.items = [createQuotationLine(firstProduct, productCategoryName(firstProduct), quote.currency)];
      selectedProductIds.value = [firstProduct.id];
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "产品列表加载失败"));
  } finally {
    loadingProducts.value = false;
  }
};

const downloadHtml = () => {
  persistDraft();
  const chineseDraft = cloneDraft(quote);
  chineseDraft.language = "zh-CN";
  downloadDraftHtml(chineseDraft);
  ElMessage.success("中文 HTML 报价单已生成");
};

const openWebDialog = () => {
  persistDraft();
  webDialogVisible.value = true;
};

const validateWebQuotation = () => {
  if (!quote.items.length) {
    ElMessage.warning("请至少选择一个产品");
    return false;
  }
  if (targetLanguage.value !== "zh-CN" && !selectedTranslationModel.value) {
    ElMessage.warning("请选择已配置的翻译模型");
    return false;
  }
  return true;
};

const buildSelectedLanguageQuotation = async () => targetLanguage.value === "zh-CN"
  ? { ...cloneDraft(quote), language: "zh-CN" as const }
  : await buildTranslatedQuotation();

const selectedLanguageName = () => PRODUCT_LANGUAGES.find((item) => item.code === targetLanguage.value)?.name || targetLanguage.value;

const downloadWebQuotation = async () => {
  if (!validateWebQuotation()) return;
  webOutputAction.value = "download";
  translating.value = true;
  try {
    const outputDraft = await buildSelectedLanguageQuotation();
    downloadDraftHtml(outputDraft);
    webDialogVisible.value = false;
    ElMessage.success(`${selectedLanguageName()} HTML 报价单已下载`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "HTML 报价单生成失败"));
  } finally {
    translating.value = false;
    webOutputAction.value = "";
  }
};

const openGeneratingWindow = () => {
  const preview = window.open("", "_blank");
  if (!preview) {
    ElMessage.warning("浏览器阻止了新窗口，请允许弹出窗口后重试");
    return null;
  }
  preview.opener = null;
  preview.document.write('<!doctype html><meta charset="UTF-8"><title>正在生成报价单</title><style>body{display:grid;place-items:center;min-height:100vh;margin:0;font:16px "Microsoft YaHei",sans-serif;color:#344054;background:#f4f6f8}</style><p>正在生成报价单...</p>');
  return preview;
};

const waitForPreviewAssets = async (preview: Window) => {
  const images = Array.from(preview.document.images);
  await Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      })));
  await preview.document.fonts?.ready;
};

const exportPdfQuotation = async () => {
  if (!validateWebQuotation()) return;
  const preview = openGeneratingWindow();
  if (!preview) return;

  webOutputAction.value = "pdf";
  translating.value = true;
  try {
    const outputDraft = await buildSelectedLanguageQuotation();
    preview.document.open();
    preview.document.write(buildQuotationHtml(outputDraft));
    preview.document.close();
    await waitForPreviewAssets(preview);
    webDialogVisible.value = false;
    preview.focus();
    preview.print();
    ElMessage.success(`${selectedLanguageName()} PDF 已就绪，请在打印窗口选择“另存为 PDF”`);
  } catch (error) {
    preview.close();
    ElMessage.error(getErrorMessage(error, "PDF 报价单生成失败"));
  } finally {
    translating.value = false;
    webOutputAction.value = "";
  }
};

const generateWebQuotation = async () => {
  if (!validateWebQuotation()) return;

  const preview = openGeneratingWindow();
  if (!preview) return;

  webOutputAction.value = "open";
  translating.value = true;
  try {
    const outputDraft = await buildSelectedLanguageQuotation();
    preview.document.open();
    preview.document.write(buildQuotationHtml(outputDraft));
    preview.document.close();
    webDialogVisible.value = false;
    ElMessage.success(`${selectedLanguageName()} 网页报价单已生成`);
  } catch (error) {
    preview.close();
    ElMessage.error(getErrorMessage(error, "网页报价单生成失败"));
  } finally {
    translating.value = false;
    webOutputAction.value = "";
  }
};

watch(quote, persistDraft, { deep: true });

onMounted(async () => {
  const restored = restoreDraft();
  await Promise.all([loadCurrentSiteProfile(), loadProducts(), loadQuotationList(), loadTranslationModels()]);
  applyCurrentSiteProfile(quote, !restored || restoredFromLegacyDraft.value);
  if (!restored) await applyNextQuotationNumber();
});
</script>

<style scoped>
.quotation-page { gap: 14px; }
.page-bar { align-items: flex-start; }
.page-bar p { margin: 4px 0 0; }
.page-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.quotation-view-tabs { display: flex; gap: 4px; padding: 5px; border: 1px solid var(--el-border-color-light); border-radius: 7px; background: var(--el-bg-color); }
.quotation-view-tabs button { min-height: 34px; padding: 0 16px; border: 0; border-radius: 5px; color: var(--el-text-color-regular); background: transparent; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.quotation-view-tabs button.active { color: #fff; background: var(--el-color-primary); }
.quotation-list-panel { min-width: 0; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 7px; background: var(--el-bg-color); box-shadow: var(--shadow-card); }
.list-summary { display: grid; grid-template-columns: 180px minmax(220px, 1fr) minmax(220px, 1fr); margin-bottom: 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-extra-light); }
.list-summary > div { display: grid; gap: 4px; padding: 13px 16px; border-right: 1px solid var(--el-border-color-lighter); }
.list-summary > div:last-child { border-right: 0; }
.list-summary span { color: var(--el-text-color-secondary); font-size: 11px; }
.list-summary strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.list-filter { display: grid; grid-template-columns: minmax(280px, 1fr) auto; gap: 8px; margin-bottom: 12px; }
.quotation-table { width: 100%; }
.record-total { color: var(--text-success); font-variant-numeric: tabular-nums; }
.quotation-workbench { display: grid; grid-template-columns: 440px minmax(0, 1fr); gap: 16px; align-items: start; }
.quotation-editor { display: grid; gap: 12px; min-width: 0; }
.editor-section { min-width: 0; padding: 14px; border: 1px solid var(--el-border-color-light); border-radius: 7px; background: var(--el-bg-color); box-shadow: var(--shadow-card); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.section-heading > div { display: flex; align-items: center; gap: 8px; }
.section-heading span { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 5px; color: var(--el-color-primary-dark-2); background: var(--el-color-primary-light-9); font-size: 11px; font-weight: 800; }
.section-heading h3 { margin: 0; font-size: 15px; }
.section-heading > strong { color: var(--text-success); font-size: 13px; }
.compact-form :deep(.el-form-item) { margin-bottom: 12px; }
.compact-form :deep(.el-form-item__label) { height: auto; padding-bottom: 5px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.25; }
.compact-form :deep(.el-date-editor), .compact-form :deep(.el-input-number), .compact-form :deep(.el-select) { width: 100%; }
.form-grid { display: grid; gap: 0 10px; }
.form-grid.two { grid-template-columns: 1fr 1fr; }
.form-grid.three { grid-template-columns: repeat(3, 1fr); }
.product-picker { width: 100%; }
.product-option { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; }
.product-option .el-image { width: 38px; height: 30px; }
.product-option span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.product-option small { color: var(--el-text-color-secondary); }
.line-list { display: grid; gap: 10px; margin-top: 12px; }
.line-editor { border: 1px solid var(--el-border-color-light); border-radius: 6px; overflow: hidden; background: var(--el-bg-color); }
.line-main { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px; }
.line-image { width: 64px; height: 52px; border: 1px solid var(--el-border-color-lighter); border-radius: 4px; background: var(--el-fill-color-light); }
.image-fallback { display: grid; place-items: center; height: 100%; color: var(--el-text-color-secondary); font-size: 11px; }
.line-title { min-width: 0; }
.line-title > span, .line-total > span, .line-pricing label > span { display: block; margin-bottom: 4px; color: var(--el-text-color-secondary); font-size: 11px; }
.line-title :deep(.el-input__inner) { font-weight: 650; }
.line-total { min-width: 126px; text-align: right; }
.line-total strong { font-size: 13px; font-variant-numeric: tabular-nums; }
.line-tools { display: flex; grid-column: 2 / -1; justify-content: flex-end; gap: 5px; }
.line-pricing { display: grid; grid-template-columns: 84px minmax(140px, 1fr); align-items: start; gap: 8px; padding: 10px; border-top: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-extra-light); }
.line-pricing label, .line-image-field { min-width: 0; }
.line-pricing :deep(.el-input-number), .line-pricing :deep(.el-select) { width: 100%; }
.line-image-field { grid-column: 1 / -1; }
.image-picker-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 16px; margin-bottom: 4px; color: var(--el-text-color-secondary); font-size: 11px; }
.image-picker-heading small { color: var(--el-color-primary); font-size: 11px; font-weight: 700; }
.line-image-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.image-choice { position: relative; display: grid; place-items: center; min-width: 0; aspect-ratio: 4 / 3; overflow: hidden; padding: 2px; border: 1px solid var(--el-border-color); border-radius: 4px; background: #fff; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.image-choice:hover { border-color: var(--el-color-primary-light-3); transform: translateY(-1px); }
.image-choice.is-selected { border-color: var(--el-color-primary); box-shadow: 0 0 0 1px var(--el-color-primary) inset; }
.image-choice :deep(.el-image) { width: 100%; height: 100%; }
.image-choice-label { position: absolute; right: 2px; bottom: 2px; left: 2px; overflow: hidden; padding: 2px 3px; background: rgba(17,24,39,.76); color: #fff; font-size: 9px; line-height: 1.25; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.image-choice-order { position: absolute; top: 3px; right: 3px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--el-color-primary); color: #fff; font-size: 10px; font-weight: 800; box-shadow: 0 1px 3px rgba(0,0,0,.22); }
.image-picker-limit { display: block; margin-top: 4px; color: var(--el-color-warning-dark-2); font-size: 10px; }
.line-details { border-top: 1px solid var(--el-border-color-lighter); }
.line-details summary, .company-settings > summary { padding: 9px 11px; color: var(--el-color-primary-dark-2); font-size: 12px; font-weight: 700; cursor: pointer; }
.details-body { display: grid; gap: 8px; padding: 0 10px 10px; }
.company-settings { padding: 0; }
.company-settings[open] > summary { border-bottom: 1px solid var(--el-border-color-lighter); }
.company-settings-body { padding: 12px 14px 2px; }
.logo-setting { display: grid; grid-template-columns: 88px minmax(0, 1fr) auto; align-items: end; gap: 10px; margin-bottom: 10px; }
.logo-setting :deep(.el-form-item) { margin-bottom: 0; }
.logo-preview { display: grid; place-items: center; width: 88px; height: 52px; overflow: hidden; border: 1px solid var(--el-border-color-light); border-radius: 5px; background: #fff; }
.logo-preview .el-image { width: 100%; height: 100%; }
.quote-preview-pane { position: relative; min-width: 0; overflow: visible; border: 1px solid var(--el-border-color-light); border-radius: 7px; background: #dfe3e9; box-shadow: var(--shadow-card); }
.preview-toolbar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 8px 12px; border-bottom: 1px solid var(--el-border-color-light); background: rgba(255,255,255,.97); }
.preview-toolbar > div { display: flex; gap: 10px; align-items: baseline; }
.preview-toolbar span { color: var(--el-text-color-secondary); font-size: 11px; }
.preview-toolbar strong { font-size: 13px; }
.quote-preview-frame { min-width: 0; padding: 1px; }
.quote-preview-frame :deep(.quotation-document) { width: calc(100% - 12px); margin: 10px auto; padding: 28px 26px; box-shadow: 0 4px 18px rgba(31,45,61,.14); }
.saved-preview-frame { max-height: calc(90vh - 120px); overflow: auto; padding: 8px; background: #dfe3e9; }
.saved-preview-frame :deep(.quotation-document) { width: min(calc(100% - 12px), 1600px); margin: 8px auto; box-shadow: 0 4px 18px rgba(31,45,61,.14); }
.web-output-dialog :deep(.el-select) { width: 100%; }

@media (max-width: 1280px) {
  .quotation-workbench { grid-template-columns: 390px minmax(0, 1fr); }
  .form-grid.three { grid-template-columns: 1fr 1fr; }
  .line-pricing { grid-template-columns: 76px 1fr; }
}

@media (max-width: 980px) {
  .page-bar { display: grid; }
  .page-actions { justify-content: flex-start; }
  .quotation-workbench { grid-template-columns: 1fr; }
  .quote-preview-pane { position: static; }
  .list-summary { grid-template-columns: 1fr; }
  .list-summary > div { border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  .list-summary > div:last-child { border-bottom: 0; }
}

@media (max-width: 640px) {
  .form-grid.two, .form-grid.three, .line-pricing { grid-template-columns: 1fr; }
  .logo-setting { grid-template-columns: 1fr; }
  .logo-preview { width: 100%; }
  .line-main { grid-template-columns: 54px minmax(0, 1fr); }
  .line-total { grid-column: 2; min-width: 0; text-align: left; }
  .line-tools { grid-column: 1 / -1; }
  .quote-preview-frame :deep(.quotation-document) { width: calc(100% - 16px); padding: 18px 12px; }
  .list-filter { grid-template-columns: 1fr; }
  .quotation-list-panel { padding: 10px; }
}
</style>
