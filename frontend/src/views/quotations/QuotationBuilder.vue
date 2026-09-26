<template>
  <section class="page quotation-page" :aria-busy="busy">
    <div class="page-bar">
      <div>
        <h2>{{ workspaceView === "editor" ? "报价单生成" : "报价单列表" }}</h2>
        <p v-if="workspaceView === 'editor'">
          {{ quotationLanguageName(quote.language) }} · {{ quote.quotationNo }} · {{ !currentQuotationId ? '未保存' : dirty ? '未保存修改' : '已保存' }}
        </p>
        <p v-else>管理已经保存的报价单，可继续编辑、预览、下载或删除。</p>
      </div>
      <div v-if="workspaceView === 'editor'" class="page-actions">
        <el-button :icon="RefreshLeft" :disabled="busy" @click="resetDraft">新建报价</el-button>
        <el-button @click="showQuotationList">报价单列表</el-button>
        <el-button type="primary" :icon="Check" :loading="savingQuotation" :disabled="busy" @click="saveQuotation">
          {{ currentQuotationId ? "保存修改" : "保存报价单" }}
        </el-button>
        <el-button :icon="View" :disabled="busy || !quote.items.length" @click="exportDocument('web')">打开网页</el-button>
        <el-button :icon="Download" :disabled="busy || !quote.items.length" @click="exportDocument('html')">下载 HTML</el-button>
        <el-button type="success" :icon="Download" :loading="exporting" :disabled="busy || !quote.items.length" @click="exportDocument('pdf')">导出 PDF</el-button>
      </div>
      <div v-else class="page-actions">
        <el-button :icon="RefreshLeft" :loading="loadingQuotations" @click="loadQuotationList">刷新列表</el-button>
        <el-button v-if="currentQuotationId" @click="workspaceView = 'editor'">继续编辑</el-button>
        <el-button type="primary" @click="createNewQuotation">新建报价</el-button>
      </div>
    </div>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon @close="errorMessage = ''" />
    <el-alert v-if="exportProgress" :title="exportProgress" type="info" :closable="false" />
    <div class="quotation-view-tabs" :inert="busy">
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
        <el-select v-model="listLanguage" clearable placeholder="全部语言" aria-label="筛选报价语言"><el-option v-for="language in availableLanguages" :key="language.code" :label="language.name" :value="language.code" /></el-select>
        <el-button type="primary" @click="loadQuotationList">查询</el-button>
      </div>
      <el-table v-loading="loadingQuotations" :data="filteredRecords" border stripe class="quotation-table" empty-text="暂无已保存报价单">
        <el-table-column prop="quotationNo" label="报价单编号" min-width="170" />
        <el-table-column label="语言" min-width="110"><template #default="{ row }">{{ quotationLanguageName(row.data?.language) }}</template></el-table-column>
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
            <el-button type="success" link :disabled="busy" @click="exportDocument('pdf', normalizeQuotation(row.data))">PDF</el-button>
            <el-button type="danger" link @click="deleteSavedQuotation(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <div v-else>
      <div class="workspace-controls">
        <el-select :model-value="quote.language" :disabled="busy" aria-label="报价语言" @change="changeLanguage"><el-option v-for="language in availableLanguages" :key="language.code" :label="language.name" :value="language.code" /></el-select>
        <el-radio-group v-model="viewMode" size="small"><el-radio-button value="split">编辑与预览</el-radio-button><el-radio-button value="edit">编辑</el-radio-button><el-radio-button value="preview">预览</el-radio-button></el-radio-group>
        <el-tag v-if="switchingLanguage">读取语言版本</el-tag>
      </div>
      <el-alert v-for="warning in warnings" :key="warning" :title="warning" type="warning" :closable="false" show-icon class="quotation-warning" />
      <div class="quotation-workbench" :class="{ 'single-pane': viewMode !== 'split' }">
      <fieldset v-show="viewMode !== 'preview'" class="quotation-editor" :disabled="busy" :inert="busy">
        <QuotationLayoutSettings v-model="quote.layout" />
        <section class="editor-section">
          <div class="section-heading">
            <div><span>01</span><h3>报价信息</h3></div>
            <strong>{{ formatMoney(grandTotal, quote.currency) }}</strong>
          </div>
          <el-form label-position="top" class="compact-form">
            <div class="form-grid two">
              <el-form-item label="报价标题"><el-input v-model="quote.title" /></el-form-item>
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
                <el-input v-model="quote.customized" />
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
                <label><span>单位</span><el-input v-model="item.unit" /></label>
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
      </fieldset>

      <aside v-if="viewMode !== 'edit'" class="quote-preview-pane">
        <QuotationDocumentPreview title="报价单 PDF 预览" :paper-label="quotationPaperLabel(quote.layout)" :render="previewRenderer" />
      </aside>
      </div>
    </div>

    <el-dialog v-model="savedPreviewVisible" :title="savedPreviewRecord?.quotationNo || '报价单预览'" width="96vw" top="2vh" destroy-on-close class="saved-preview-dialog">
      <QuotationDocumentPreview v-if="savedPreviewVisible" title="已保存报价预览" :paper-label="quotationPaperLabel(savedPreviewRecord?.data.layout)" :render="savedPreviewRenderer" />
      <template #footer>
        <el-button @click="savedPreviewVisible = false">关闭</el-button>
        <el-button v-if="savedPreviewRecord" type="primary" @click="downloadSavedQuotation(savedPreviewRecord)">下载 HTML</el-button>
        <el-button v-if="savedPreviewRecord" type="success" :disabled="busy" @click="exportDocument('pdf', savedPreviewRecord.data)">导出 PDF</el-button>
      </template>
    </el-dialog>

  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, ArrowUp, Check, Delete, Download, RefreshLeft, View } from "@element-plus/icons-vue";
import { getProductList, getProductById, type ProductItem } from "@/api/products";
import { getAll as getAllMenus, type MenuItem } from "@/api/menus";
import { getCurrentSiteProfile, type SiteBusinessProfile } from "@/api/sites";
import { createQuotation, getNextQuotationNumber, getQuotationById, getQuotationList, removeQuotation, updateQuotation, exportQuotationPdf, type QuotationPayload, type QuotationRecord } from "@/api/quotations";
import { getUploadUrl } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import { buildQuotationHtml, buildQuotationWebHtml, createDefaultQuotation, createQuotationLine, formatMoney, parseSpecificationText, quotationHtmlFileName, quotationSubtotal, quotationTotal, normalizeQuotation, validateQuotation, portableQuotation, type QuotationDraft, type QuotationLanguageCode, type QuotationLine } from "@/utils/quotation";
import { quotationLanguage, quotationLanguageName, quotationLanguageDraft, quotationWarnings } from "@/utils/quotation-language";
import { exactQuotationProduct } from "@/utils/quotation-language";
import { findEquivalentMenuForLang } from "@/utils/menuLanguage";
import { paginateQuotationForExport } from "@/utils/quotation-pagination";
import QuotationDocumentPreview from "@/components/QuotationDocumentPreview.vue";
import QuotationLayoutSettings from "@/components/QuotationLayoutSettings.vue";
import { quotationPaperLabel } from "@/utils/quotation-layout";
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";
import { getActiveSiteId } from "@/utils/siteSelection";

const availableLanguages = useAvailableLanguages();
const siteId = getActiveSiteId();
const draftKey = `pboot-quotation-draft-v1:site:${siteId}`;
const idKey = `pboot-quotation-current-id-v1:site:${siteId}`;
const quote = reactive<QuotationDraft>(createDefaultQuotation());
const currentSiteProfile = ref<SiteBusinessProfile | null>(null);
const loadingSiteProfile = ref(false);
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
const listLanguage = ref("");
const savedPreviewVisible = ref(false);
const savedPreviewRecord = ref<QuotationRecord | null>(null);
const switchingLanguage = ref(false);
const importing = ref(false);
const exporting = ref(false);
const readingRecord = ref(false);
const initializing = ref(true);
const cacheBlocked = ref(false);
const errorMessage = ref("");
const exportProgress = ref("");
const baseline = ref("");
const viewMode = ref("split");
const busy = computed(() => initializing.value || savingQuotation.value || switchingLanguage.value || importing.value || exporting.value || readingRecord.value);
const dirty = computed(() => baseline.value !== JSON.stringify(quote));
const warnings = computed(() => quotationWarnings(quote));
const filteredRecords = computed(() => quotationRecords.value.filter(row => !listLanguage.value || quotationLanguage(row.data?.language) === listLanguage.value));
const currencies = ["USD", "CNY", "EUR"];
const incoterms = ["EXW", "FOB", "CIF", "CFR"];
const transportModes = ["海运", "陆运", "空运", "客户自提"];
let active = true;
const assertScope = () => { if (!active || getActiveSiteId() !== siteId) throw new Error("网站已切换，请在当前网站重新操作"); };
const cloneDraft = (draft: QuotationDraft): QuotationDraft => JSON.parse(JSON.stringify(draft));
const reportError = (error: unknown, fallback: string) => { if (active) errorMessage.value = getErrorMessage(error, fallback); };
const subtotal = computed(() => quotationSubtotal(quote));
const grandTotal = computed(() => quotationTotal(quote));
const previewRenderer = computed(() => { const snapshot = cloneDraft(quote); return (token: string) => buildQuotationHtml(snapshot, token); });
const savedPreviewRenderer = computed(() => { const snapshot = savedPreviewRecord.value ? cloneDraft(savedPreviewRecord.value.data) : createDefaultQuotation(); return (token: string) => buildQuotationHtml(snapshot, token); });
const latestQuotationTime = computed(() => quotationRecords.value[0]?.updateTime ? formatDateTime(quotationRecords.value[0].updateTime) : "-");
const productMap = computed(() => new Map(products.value.map(product => [product.id, product])));
const productCategoryName = (product: ProductItem, language = quote.language) => findEquivalentMenuForLang(menus.value, product.menuId, language, "3")?.name || "";
const productOptionLabel = (product: ProductItem) => `${product.title || '#' + product.id} ${productCategoryName(product)}`.trim();
const primaryLineImage = (item: QuotationLine) => item.images?.[0] || "";
const selectedLineImageIndex = (item: QuotationLine, image: string) => (item.images || []).indexOf(image);
const isLineImageSelected = (item: QuotationLine, image: string) => selectedLineImageIndex(item, image) >= 0;
const lineTotal = (item: QuotationLine) => Number(item.quantity || 0) * Number(item.unitPrice || 0);
const imageOptions = (productId: number) => {
  const product = productMap.value.get(productId);
  if (!product) return [];
  const values = [{label:"产品大图",value:product.largeImage}, {label:"缩略图",value:product.thumbnail}, ...(product.carouselImages || []).map((value,index) => ({label:`产品图 ${index+1}`,value}))].filter(item => item.value);
  return values.filter((item,index) => values.findIndex(candidate => candidate.value === item.value) === index);
};
function toggleLineImage(item: QuotationLine, image: string) {
  if (busy.value) return;
  const images = [...(item.images || [])], index = images.indexOf(image);
  if (index >= 0) images.splice(index,1);
  else if (images.length >= 3) { ElMessage.warning("最多展示 3 张图片，请先取消一张"); return; }
  else images.push(image);
  item.images = images; item.image = images[0] || "";
}
async function translatedLine(id: number, language: QuotationLanguageCode) {
  assertScope();
  const product = exactQuotationProduct((await getProductById(id, language)).data, language);
  assertScope();
  if (!product.title.trim()) throw new Error(`产品 #${id} 缺少${quotationLanguageName(language)}译文，请先在产品管理完成翻译`);
  return createQuotationLine(product, productCategoryName(product, language), quote.currency, language);
}
async function applyProductSelection(ids: number[]) {
  if (busy.value) { selectedProductIds.value = quote.items.map(item => item.productId); return; }
  importing.value = true; errorMessage.value = "";
  try {
    if (ids.length > 20) throw new Error("每份报价最多 20 个产品");
    const next: QuotationLine[] = [], existing = new Map(quote.items.map(item => [item.productId,item]));
    for (const id of ids) next.push(existing.get(id) || await translatedLine(id, quote.language));
    assertScope(); quote.items = next;
  } catch (error) { reportError(error,"产品导入失败"); }
  finally { selectedProductIds.value = quote.items.map(item => item.productId); importing.value = false; }
}
function moveLine(index: number, offset: number) {
  if (busy.value || index + offset < 0 || index + offset >= quote.items.length) return;
  const [item] = quote.items.splice(index,1); quote.items.splice(index+offset,0,item);
  selectedProductIds.value = quote.items.map(line => line.productId);
}
function removeLine(index: number) {
  if (busy.value) return;
  quote.items.splice(index,1); selectedProductIds.value = quote.items.map(line => line.productId);
}
function applyCurrentSiteProfile(overwrite = false) {
  const profile = currentSiteProfile.value; if (!profile) return;
  const fields = { companyName:profile.companyName, companySubtitle:profile.companySubtitle, logoUrl:profile.logoUrl, website:profile.website, assetBaseUrl:profile.assetBaseUrl, salesName:profile.contactName, phone:profile.phone, whatsapp:profile.whatsapp, wechat:profile.wechat, email:profile.email };
  for (const [key,value] of Object.entries(fields)) { const field = key as keyof typeof fields; if (overwrite || !quote[field]) quote[field] = value || ""; }
}
async function loadCurrentSiteProfile() {
  loadingSiteProfile.value = true; currentSiteProfile.value = null;
  try { const result = await getCurrentSiteProfile(); assertScope(); currentSiteProfile.value = result.data; }
  catch (error) { reportError(error,"当前网站资料读取失败"); }
  finally { loadingSiteProfile.value = false; }
}
async function reloadCurrentSiteProfile() {
  if (busy.value) return;
  try { await ElMessageBox.confirm("替换当前报价的公司抬头和联系方式？", "读取网站资料"); }
  catch { return; }
  await loadCurrentSiteProfile(); assertScope(); applyCurrentSiteProfile(true);
}
function persistDraft() {
  if (initializing.value || cacheBlocked.value || !active) return;
  try {
    // The captured site ID prevents a pending task from moving a draft into another website.
    localStorage.setItem(draftKey, JSON.stringify(quote));
    if (currentQuotationId.value) localStorage.setItem(idKey, String(currentQuotationId.value));
    else localStorage.removeItem(idKey);
  } catch { errorMessage.value = "浏览器草稿缓存写入失败，请点击保存报价单。"; }
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(draftKey); if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.items)) throw new Error("invalid");
    Object.assign(quote, normalizeQuotation(saved));
    const id = Number(localStorage.getItem(idKey));
    currentQuotationId.value = Number.isSafeInteger(id) && id > 0 ? id : null;
    return true;
  } catch { cacheBlocked.value = true; errorMessage.value = "本地草稿格式异常，已保留原缓存。请从报价单列表打开已保存资料，或明确新建报价。"; return true; }
}
async function loadProducts() {
  loadingProducts.value = true;
  try {
    const result = await getProductList(undefined, quote.language); assertScope();
    products.value = result.data;
    selectedProductIds.value = quote.items.map(item => item.productId);
  } catch (error) { reportError(error,"产品列表加载失败"); }
  finally { loadingProducts.value = false; }
}
async function loadQuotationList() {
  loadingQuotations.value = true;
  try { const result = await getQuotationList(quotationSearch.value); assertScope(); quotationRecords.value = result.data; }
  catch (error) { reportError(error,"报价列表读取失败"); }
  finally { loadingQuotations.value = false; }
}
function showQuotationList() { if (busy.value) return; workspaceView.value = "list"; void loadQuotationList(); }
function quotationPayload(): QuotationPayload {
  const data = cloneDraft(quote);
  return { quotationNo:data.quotationNo.trim(), customerCompany:data.customerCompany.trim(), customerContact:data.customerContact.trim(), currency:data.currency, total:quotationTotal(data), itemCount:data.items.length, quotationDate:data.quotationDate, data };
}
async function saveQuotation() {
  if (savingQuotation.value || exporting.value || importing.value || initializing.value) return false;
  savingQuotation.value = true; errorMessage.value = "";
  try {
    assertScope(); validateQuotation(quote);
    const payload = quotationPayload();
    const result = currentQuotationId.value ? await updateQuotation(currentQuotationId.value, payload) : await createQuotation(payload);
    assertScope(); currentQuotationId.value = result.data.id; baseline.value = JSON.stringify(quote);
    persistDraft(); await loadQuotationList(); ElMessage.success("报价单已保存"); return true;
  } catch (error) { reportError(error,"报价单保存失败"); return false; }
  finally { savingQuotation.value = false; }
}
async function changeLanguage(value: string) {
  if (busy.value || value === quote.language || !availableLanguages.value.some(lang => lang.code === value)) return;
  const language = quotationLanguage(value);
  if (!quote.items.length) {
    Object.assign(quote, quotationLanguageDraft(quote,language,[])); currentQuotationId.value = null; await loadProducts(); return;
  }
  try { await ElMessageBox.confirm(`先保存当前报价，再另建${quotationLanguageName(language)}版本。产品名称和参数读取产品库译文；自定义参数不自动翻译。金额、客户资料、已选图片和自定义商务条款保留，需核对新版本。原报价不覆盖。`, "切换报价语言", {type:"warning",confirmButtonText:"保存并新建语言版本"}); }
  catch { return; }
  switchingLanguage.value = true; errorMessage.value = "";
  try {
    if (!await saveQuotation()) return;
    const original = cloneDraft(quote), lines: QuotationLine[] = [];
    for (const item of original.items) lines.push(await translatedLine(item.productId,language));
    const next = quotationLanguageDraft(original,language,lines);
    const number = await getNextQuotationNumber(next.quotationDate); assertScope();
    next.quotationNo = number.data.quotationNo;
    Object.assign(quote,next); currentQuotationId.value = null; baseline.value = "";
    persistDraft(); await loadProducts();
    ElMessage.success("已新建独立语言版本，请核对条款后保存");
  } catch (error) { reportError(error,"语言切换失败，原报价已保留"); }
  finally { switchingLanguage.value = false; }
}
async function confirmReplace() {
  if (!dirty.value) return true;
  try { await ElMessageBox.confirm("当前报价有未保存内容，是否放弃当前编辑？", "切换报价", {type:"warning"}); return true; }
  catch { return false; }
}
async function resetDraft() {
  if (busy.value || !await confirmReplace()) return false;
  readingRecord.value = true;
  try {
    const next = createDefaultQuotation(), result = await getNextQuotationNumber(next.quotationDate); assertScope();
    next.quotationNo = result.data.quotationNo; Object.assign(quote,next);
    currentQuotationId.value = null; selectedProductIds.value = []; cacheBlocked.value = false; baseline.value = "";
    applyCurrentSiteProfile(true); workspaceView.value = "editor"; errorMessage.value = ""; persistDraft(); await loadProducts(); return true;
  } catch (error) { reportError(error,"新建失败，原稿已保留"); return false; }
  finally { readingRecord.value = false; }
}
const createNewQuotation = resetDraft;
async function previewSavedQuotation(record: QuotationRecord) {
  if (busy.value) return;
  readingRecord.value = true;
  try { const result = await getQuotationById(record.id); assertScope(); savedPreviewRecord.value = {...result.data,data:normalizeQuotation(result.data.data)}; savedPreviewVisible.value = true; }
  catch (error) { reportError(error,"报价单读取失败"); }
  finally { readingRecord.value = false; }
}
async function editSavedQuotation(record: QuotationRecord) {
  if (busy.value || !await confirmReplace()) return;
  readingRecord.value = true;
  try {
    const result = await getQuotationById(record.id); assertScope();
    Object.assign(quote, normalizeQuotation(result.data.data)); currentQuotationId.value = result.data.id;
    baseline.value = JSON.stringify(quote); cacheBlocked.value = false;
    workspaceView.value = "editor"; persistDraft(); await loadProducts();
  } catch (error) { reportError(error,"报价单读取失败"); }
  finally { readingRecord.value = false; }
}
async function deleteSavedQuotation(record: QuotationRecord) {
  if (busy.value) return;
  try { await ElMessageBox.confirm(`删除报价单 ${record.quotationNo}？`,"删除报价单",{type:"warning"}); }
  catch { return; }
  readingRecord.value = true;
  try {
    assertScope(); await removeQuotation(record.id); assertScope();
    if (currentQuotationId.value === record.id) { currentQuotationId.value = null; baseline.value = ""; persistDraft(); }
    if (savedPreviewRecord.value?.id === record.id) savedPreviewVisible.value = false;
    await loadQuotationList();
  } catch (error) { reportError(error,"删除失败"); }
  finally { readingRecord.value = false; }
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportDocument(action: "web" | "html" | "pdf", source: QuotationDraft = quote) {
  if (busy.value) return;
  try { validateQuotation(source); assertScope(); } catch(error) { reportError(error,"请检查报价"); return; }
  const draft = cloneDraft(source);
  const popup = action === "web" ? window.open("about:blank","_blank") : null;
  if (action === "web" && !popup) { ElMessage.warning("请允许打开新窗口"); return; }
  if (popup) { popup.opener = null; popup.document.title = "正在生成报价单"; popup.document.body.textContent = "正在生成报价单..."; }
  exporting.value = true; errorMessage.value = ""; exportProgress.value = "准备图片";
  try {
    const portable = await portableQuotation(draft,(done,total) => { exportProgress.value = `处理图片 ${done}/${total}`; });
    if (action !== 'pdf') {
      assertScope();
      const blob = new Blob([buildQuotationWebHtml(portable)], { type: 'text/html;charset=utf-8' });
      if (action === 'html') downloadBlob(blob, quotationHtmlFileName(draft));
      else if (popup && !popup.closed) {
        const url = URL.createObjectURL(blob); popup.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      ElMessage.success(`${quotationLanguageName(draft.language)}网页版报价已生成`);
      return;
    }
    assertScope(); exportProgress.value = `${quotationPaperLabel(draft.layout)} 排版中`;
    const token = crypto.randomUUID(), result = await paginateQuotationForExport(buildQuotationHtml(portable,token),token);
    assertScope();
    if (action === "pdf") {
      exportProgress.value = "服务器生成 PDF";
      const blob = await exportQuotationPdf(result.html, draft.layout); assertScope();
      downloadBlob(blob,quotationHtmlFileName(draft).replace(/\.html$/i,".pdf"));
    }
    ElMessage.success(`${quotationLanguageName(draft.language)}报价已生成，共 ${result.pages} 页`);
  } catch(error) { popup?.close(); reportError(error,"报价导出失败，请重试"); }
  finally { exporting.value = false; exportProgress.value = ""; }
}
const downloadSavedQuotation = (record: QuotationRecord) => exportDocument("html",normalizeQuotation(record.data));
function formatDateTime(value: string) {
  const date = new Date(value);
  return !value ? "-" : Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN",{hour12:false});
}
watch(quote,persistDraft,{deep:true});
onBeforeRouteLeave(() => !busy.value);
onMounted(async () => {
  const restored = restoreDraft();
  try {
    menus.value = (await getAllMenus()).data; assertScope();
    await loadCurrentSiteProfile(); await loadProducts(); await loadQuotationList();
    if (!restored) {
      applyCurrentSiteProfile(true);
      const result = await getNextQuotationNumber(quote.quotationDate); assertScope(); quote.quotationNo = result.data.quotationNo;
      baseline.value = JSON.stringify(quote);
    }
  } catch(error) { reportError(error,"报价工作台加载失败"); }
  finally { initializing.value = false; }
});
onBeforeUnmount(() => { persistDraft(); active = false; });
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
.quotation-workbench { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; align-items:start; }
.quotation-workbench.single-pane { grid-template-columns:minmax(0,1fr); }
.quotation-editor { display:grid; gap:0; min-width:0; margin:0; padding:0; border:0; background:var(--el-bg-color); }
.editor-section { min-width:0; padding:24px; border:0; border-bottom:1px solid var(--el-border-color-light); border-radius:0; box-shadow:none; }
.workspace-controls { display:flex; align-items:center; flex-wrap:wrap; gap:14px; padding:0 0 18px; }
.workspace-controls .el-select { width:190px; }
.quotation-warning { margin-bottom:12px; }
.form-grid>* { min-width:0; }
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
.quote-preview-pane { position:sticky; top:16px; min-width:0; border:0; background:transparent; }
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
.list-filter { grid-template-columns:minmax(200px,1fr) 180px auto; }
.line-pricing { grid-template-columns:minmax(70px,1fr) minmax(50px,.6fr) minmax(120px,1.5fr); }
.quotation-list-panel { border:0; box-shadow:none; border-radius:0; }
.list-summary { border:0; border-radius:0; }
@media(max-width:760px) {
  .list-filter,.line-pricing { grid-template-columns:minmax(0,1fr); }
  .editor-section { padding:16px; }
  .page-actions .el-button { margin-left:0; }
  .workspace-controls { gap:10px; }
}
</style>
