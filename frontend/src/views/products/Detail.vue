<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>产品详情</h2>
        <p>后台预览当前产品内容、缩略图和轮播图，可切换语言并同步到网站。</p>
      </div>
      <div class="actions">
        <el-select v-model="currentLang" class="lang-select" @change="handleLangChange">
          <el-option v-for="item in PRODUCT_LANGUAGES" :key="item.code" :label="item.name" :value="item.code" />
        </el-select>
        <el-button type="success" :loading="syncingCurrent" @click="handleSync(false)">同步当前语言</el-button>
        <el-button type="warning" :loading="syncingAll" @click="handleSync(true)">同步全部语言</el-button>
        <el-button @click="router.push('/products')">返回列表</el-button>
        <el-button type="primary" @click="router.push({ name: 'editProduct', params: { id: route.params.id } })">编辑产品</el-button>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />

    <article v-else-if="product" class="preview">
      <section class="hero-panel">
        <div class="media-column">
          <div class="cover-frame">
            <el-image v-if="product.thumbnail" :src="getUploadUrl(product.thumbnail)" fit="contain" class="cover">
              <template #error>
                <div class="image-empty">缩略图加载失败</div>
              </template>
            </el-image>
            <el-empty v-else description="暂无缩略图" />
          </div>
        </div>

        <div class="intro-column">
          <div class="meta-row">
            <el-tag type="primary">{{ menuName }}</el-tag>
            <el-tag type="warning">{{ getLanguageName(currentLang) }}</el-tag>
            <el-tag :type="product.show ? 'success' : 'info'">{{ product.show ? "显示" : "隐藏" }}</el-tag>
          </div>

          <h1>{{ product.title }}</h1>
          <p v-if="product.subtitle" class="subtitle">{{ product.subtitle }}</p>

          <p v-if="product.summary" class="summary">{{ product.summary }}</p>

          <div class="info-grid">
            <div>
              <span>排序</span>
              <strong>{{ product.orderNum }}</strong>
            </div>
            <div>
              <span>更新时间</span>
              <strong>{{ formatTime(product.updateTime) }}</strong>
            </div>
          </div>

          <div v-if="product.urlName || product.keywords" class="seo-grid">
            <div v-if="product.urlName">
              <span>URL名称</span>
              <strong>{{ product.urlName }}</strong>
            </div>
            <div v-if="product.keywords">
              <span>关键词</span>
              <strong>{{ product.keywords }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section v-if="product.largeImage || product.videoUrl" class="extra-media-panel">
        <div v-if="product.largeImage" class="large-image-card">
          <div class="section-head">
            <h3>产品大图</h3>
          </div>
          <el-image :src="getUploadUrl(product.largeImage)" fit="contain" class="large-image">
            <template #error>
              <div class="image-empty">产品大图加载失败</div>
            </template>
          </el-image>
        </div>
        <div v-if="product.videoUrl" class="video-card">
          <div class="section-head">
            <h3>视频地址</h3>
          </div>
          <iframe v-if="isEmbeddableVideo(product.videoUrl)" :src="product.videoUrl" class="video-frame" allowfullscreen />
          <el-link v-else :href="product.videoUrl" type="primary" target="_blank">{{ product.videoUrl }}</el-link>
        </div>
      </section>

      <section v-if="product.carouselImages?.length" class="gallery-panel">
        <div class="section-head">
          <h3>轮播多图</h3>
          <span>{{ product.carouselImages.length }} 张</span>
        </div>
        <el-carousel
          ref="carouselRef"
          height="390px"
          indicator-position="outside"
          arrow="always"
          class="product-carousel"
          @change="activeCarouselIndex = $event"
        >
          <el-carousel-item v-for="(image, index) in product.carouselImages" :key="`${image}-${index}`">
            <div class="carousel-slide">
              <el-image :src="getUploadUrl(image)" fit="contain" class="carousel-image">
                <template #error>
                  <div class="image-empty">图片加载失败</div>
                </template>
              </el-image>
              <div class="carousel-title">{{ product.carouselTitles?.[index] || `产品图 ${index + 1}` }}</div>
            </div>
          </el-carousel-item>
        </el-carousel>

        <div class="thumb-strip">
          <button
            v-for="(image, index) in product.carouselImages"
            :key="`thumb-${image}-${index}`"
            type="button"
            class="thumb-card"
            :class="{ active: activeCarouselIndex === index }"
            @click="setActiveCarousel(index)"
          >
            <el-image :src="getUploadUrl(image)" fit="contain" class="thumb-image" />
            <span>{{ product.carouselTitles?.[index] || `产品图 ${index + 1}` }}</span>
          </button>
        </div>
      </section>

      <section class="content-panel">
        <div class="section-head">
          <h3>详情内容</h3>
        </div>
        <div v-if="normalizedContent" class="content" v-html="normalizedContent" />
        <el-empty v-else description="暂无产品详情" />
      </section>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { getAll, type MenuItem } from "@/api/menus";
import { DEFAULT_PRODUCT_LANG, PRODUCT_LANGUAGES, getProductById, syncProductToPboot, type ProductItem } from "@/api/products";
import { getUploadUrl, normalizeHtmlImageUrls } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const syncingCurrent = ref(false);
const syncingAll = ref(false);
const product = ref<ProductItem>();
const menus = ref<MenuItem[]>([]);
const currentLang = ref((route.query.lang as string) || DEFAULT_PRODUCT_LANG);
const carouselRef = ref();
const activeCarouselIndex = ref(0);

const getLanguageName = (lang: string) => PRODUCT_LANGUAGES.find((item) => item.code === lang)?.name || lang;

const menuName = computed(() => {
  if (!product.value) return "未选择栏目";
  const item = menus.value.find((menu) => Number(menu.id) === Number(product.value?.menuId));
  if (!item) return `栏目 #${product.value.menuId}`;
  const parent = menus.value.find((menu) => Number(menu.id) === Number(item.parentId));
  return Number(item.parentId) === 0 ? item.name : `${parent?.name || "未知栏目"} / ${item.name}`;
});

const normalizedContent = computed(() => normalizeHtmlImageUrls(product.value?.content || ""));

const isEmbeddableVideo = (value: string) => /^https?:\/\//i.test(String(value || ""));

const formatTime = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const [menuRes, productRes] = await Promise.all([getAll(), getProductById(route.params.id as string, currentLang.value)]);
    menus.value = menuRes.data;
    product.value = productRes.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取产品详情失败"));
  } finally {
    loading.value = false;
  }
};

const handleLangChange = async () => {
  await router.replace({ name: "productDetail", params: { id: route.params.id }, query: { lang: currentLang.value } });
  await loadDetail();
};

const handleSync = async (all: boolean) => {
  if (all) syncingAll.value = true;
  else syncingCurrent.value = true;
  try {
    const res = await syncProductToPboot(route.params.id as string, all ? { all: true } : { lang: currentLang.value });
    const urls = res.data.synced.map((item) => item.url).join("，");
    ElMessage.success(`同步成功：${urls}`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步产品到网站失败"));
  } finally {
    syncingAll.value = false;
    syncingCurrent.value = false;
  }
};

const setActiveCarousel = (index: number) => {
  activeCarouselIndex.value = index;
  carouselRef.value?.setActiveItem?.(index);
};

onMounted(loadDetail);
</script>

<style scoped>
.page {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 16px;
}

.page-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-bar h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.page-bar p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular);
}

.actions,
.meta-row {
  display: flex;
  gap: 10px;
}

.actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.lang-select {
  width: 150px;
}

.preview {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  flex-direction: column;
  gap: 18px;
}

.hero-panel,
.gallery-panel,
.content-panel {
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgb(16 24 40 / 5%);
}

.hero-panel {
  display: grid;
  grid-template-columns: minmax(320px, 42%) minmax(0, 1fr);
  gap: 28px;
  align-items: stretch;
}

.cover-frame {
  display: flex;
  min-height: 360px;
  height: 100%;
  align-items: center;
  justify-content: center;
  background: #f6f8fb;
  border: 1px solid #edf0f5;
  border-radius: 8px;
}

.cover {
  width: 100%;
  height: 360px;
}

.intro-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
}

.preview h1 {
  margin: 18px 0 14px;
  color: #101828;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.35;
}

.summary {
  margin: 0 0 22px;
  padding: 14px 16px;
  color: #475467;
  line-height: 1.8;
  background: #f5f8ff;
  border-left: 4px solid var(--el-color-primary);
  border-radius: 6px;
}

.subtitle {
  margin: -4px 0 14px;
  color: var(--el-text-color-regular);
  font-size: 17px;
  line-height: 1.6;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.seo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.seo-grid div {
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #edf0f5;
  border-radius: 6px;
}

.seo-grid span {
  display: block;
  margin-bottom: 4px;
  color: #98a2b3;
  font-size: 12px;
}

.seo-grid strong {
  color: #344054;
  font-size: 14px;
  font-weight: 600;
  word-break: break-word;
}

.extra-media-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.large-image-card,
.video-card {
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.large-image {
  width: 100%;
  height: 360px;
  background: #f6f8fb;
  border-radius: 8px;
}

.video-frame {
  width: 100%;
  height: 360px;
  border: 0;
  border-radius: 8px;
  background: #101828;
}

.info-grid div {
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #edf0f5;
  border-radius: 6px;
}

.info-grid span {
  display: block;
  margin-bottom: 4px;
  color: #98a2b3;
  font-size: 12px;
}

.info-grid strong {
  display: block;
  color: #344054;
  font-size: 14px;
  font-weight: 600;
  word-break: break-word;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-head h3 {
  margin: 0;
  color: #101828;
  font-size: 18px;
  font-weight: 700;
}

.section-head span {
  color: var(--el-text-color-regular);
}

.product-carousel {
  width: min(860px, 100%);
  margin: 0 auto;
}

.carousel-slide {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
  border: 1px solid #edf0f5;
  border-radius: 8px;
}

.carousel-image {
  width: 100%;
  height: 100%;
}

.carousel-title {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: calc(100% - 32px);
  padding: 8px 12px;
  color: #fff;
  line-height: 1.5;
  background: rgb(16 24 40 / 72%);
  border-radius: 6px;
}

.thumb-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.thumb-card {
  padding: 0;
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.thumb-card:hover,
.thumb-card.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 8px 20px rgb(64 158 255 / 14%);
  transform: translateY(-1px);
}

.thumb-image {
  width: 100%;
  height: 98px;
  background: #f6f8fb;
}

.thumb-card span {
  display: block;
  padding: 8px 10px;
  overflow: hidden;
  color: #344054;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  max-width: 1080px;
  margin: 0 auto;
  color: #344054;
  font-size: 15px;
  line-height: 1.9;
}

.content :deep(img) {
  display: block;
  max-width: min(100%, 920px);
  height: auto;
  max-height: 620px;
  object-fit: contain;
  margin: 16px auto;
  border-radius: 8px;
}

.content :deep(table) {
  width: 100%;
  max-width: 980px;
  margin: 18px auto;
  border-collapse: collapse;
}

.content :deep(td),
.content :deep(th) {
  padding: 8px 10px;
  border: 1px solid #d0d5dd;
}

.image-empty {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  color: #98a2b3;
  background: #f6f8fb;
}

@media (max-width: 980px) {
  .page-bar,
  .hero-panel,
  .extra-media-panel {
    grid-template-columns: 1fr;
  }

  .page-bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .cover,
  .cover-frame {
    height: 300px;
    min-height: 300px;
  }
}
</style>
