<template>
  <div class="deployment-tutorial" :class="{ 'print-all': printMode }">
    <header class="guide-header">
      <div><div class="guide-eyebrow">PBOOT ADMIN CENTER / 运维手册</div><h1>部署教程</h1><p>{{ guide.summary }}</p></div>
      <div class="guide-actions">
        <el-tooltip content="下载完整 Markdown 教程" placement="bottom"><el-button :icon="Download" aria-label="下载完整 Markdown 教程" @click="download" /></el-tooltip>
        <el-tooltip content="打印完整图文教程" placement="bottom"><el-button :icon="Printer" :loading="printing" aria-label="打印完整图文教程" @click="printGuide" /></el-tooltip>
        <el-tooltip content="重置本浏览器核对进度" placement="bottom"><el-button :icon="RefreshLeft" aria-label="重置核对进度" @click="reset" /></el-tooltip>
      </div>
    </header>
    <p><RouterLink to="/environment-guide">本地与宝塔配置差异 / 代码发布流程</RouterLink></p>
    <div class="guide-meta"><span>更新 {{ guide.version }}</span><span>{{ guide.chapters.length }} 章 / {{ allSteps.length }} 步</span><span>{{ screenshotCount }} 张实操截图 / {{ diagramCount }} 张 SVG</span><span class="progress-label">已核对 {{ completed.length }} / {{ allSteps.length }}</span></div>
    <el-progress class="guide-progress" :percentage="percentage" :show-text="false" :stroke-width="4" />
    <el-alert v-if="storageFailed" type="warning" title="浏览器无法保存核对进度，关闭后可能丢失；不会影响服务器。" :closable="false" show-icon />
    <div class="guide-workspace">
      <aside class="guide-directory" aria-label="教程目录">
        <el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索步骤、命令或问题" aria-label="搜索教程" />
        <div class="directory-summary">{{ matchingChapters.length }} 章匹配 <el-switch v-model="annotations" size="small" active-text="箭头标注" aria-label="显示截图箭头标注" /></div>
        <nav>
          <template v-for="(chapter, index) in guide.chapters" :key="chapter.id">
            <button v-if="matchingChapters.some(item => item.id === chapter.id)" type="button" class="chapter-link" :class="{ selected: activeChapter.id === chapter.id }" :aria-current="activeChapter.id === chapter.id ? 'page' : undefined" @click="selectChapter(chapter.id)">
              <span class="chapter-number">{{ String(index + 1).padStart(2, '0') }}</span><span><small>{{ chapter.group }}</small>{{ chapter.title }}</span><el-icon v-if="chapter.steps.every(step => completed.includes(step.id))" class="chapter-complete"><CircleCheck /></el-icon>
            </button>
          </template>
        </nav>
        <p v-if="!matchingChapters.length" class="no-results" role="status">没有匹配内容，请换一个关键词。</p>
        <div class="directory-footnote">核对进度仅保存在当前浏览器，不执行部署或修改服务器。</div>
      </aside>
      <div class="guide-reading">
        <p class="guide-scope">{{ guide.scope }}</p>
        <template v-for="chapter in renderedChapters" :key="chapter.id">
          <article :id="`chapter-${chapter.id}`" class="guide-chapter">
            <div class="chapter-heading"><span>{{ chapter.group }} · {{ String(guide.chapters.indexOf(chapter) + 1).padStart(2, '0') }}</span><h2 tabindex="-1">{{ chapter.title }}</h2><p>{{ chapter.intro }}</p></div>
            <section v-for="(step, index) in chapter.steps" :key="step.id" :id="`step-${step.id}`" class="guide-step">
              <h3><span class="step-number">{{ index + 1 }}</span>{{ step.title }}</h3>
              <p v-for="(paragraph, p) in step.body" :key="p">{{ paragraph }}</p>
              <aside v-if="step.warning" class="step-warning"><el-icon><Warning /></el-icon><span>{{ step.warning }}</span></aside>
              <div v-for="(command, commandIndex) in step.commands" :key="commandIndex" class="command-block">
                <div class="command-heading"><span>{{ command.label }}</span><el-tooltip content="复制命令，不会执行" placement="top"><el-button text :icon="CopyDocument" :aria-label="`复制命令：${command.label}`" @click="copy(command.code)" /></el-tooltip></div>
                <pre><code>{{ command.code }}</code></pre>
              </div>
              <TutorialFigure v-for="mediaId in step.media" :key="mediaId" :media="media[mediaId]!" :annotations="annotations" :eager="printMode" @expand="openImage(mediaId)" />
              <label class="step-check"><input type="checkbox" :checked="completed.includes(step.id)" @change="toggleStep(step.id, ($event.target as HTMLInputElement).checked)" /><span>{{ step.check }}</span></label>
            </section>
          </article>
        </template>
        <div v-if="!printMode" class="chapter-pagination">
          <el-button :icon="ArrowLeft" :disabled="activeIndex === 0" @click="selectChapter(guide.chapters[activeIndex - 1]!.id)">上一章</el-button>
          <span>{{ activeIndex + 1 }} / {{ guide.chapters.length }}</span>
          <el-button :disabled="activeIndex === guide.chapters.length - 1" @click="selectChapter(guide.chapters[activeIndex + 1]!.id)">下一章<el-icon><ArrowRight /></el-icon></el-button>
        </div>
        <footer class="guide-references"><h3>官方参考</h3><a v-for="reference in guide.references" :key="reference.url" :href="reference.url" target="_blank" rel="noopener noreferrer">{{ reference.title }}<el-icon><TopRight /></el-icon></a><p>教程依据本项目源码与部署记录整理；只读接口通过不等于所有发布功能完成验收。</p></footer>
      </div>
    </div>
    <el-dialog v-model="imageVisible" :title="selectedMedia?.caption" width="min(1200px, 96vw)" class="tutorial-image-dialog" destroy-on-close @closed="zoom = 100">
      <div class="image-controls"><el-button :icon="ZoomOut" :disabled="zoom <= 100" aria-label="缩小截图" @click="zoom -= 25" /><span>{{ zoom }}%</span><el-button :icon="ZoomIn" :disabled="zoom >= 250" aria-label="放大截图" @click="zoom += 25" /><el-button :icon="FullScreen" aria-label="适应窗口" @click="zoom = 100" /><el-switch v-model="annotations" active-text="箭头标注" /></div>
      <div class="image-scroll"><div :style="{width: `${zoom}%`}"><TutorialFigure v-if="selectedMedia" :media="selectedMedia" :annotations="annotations" expanded eager /></div></div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, ArrowRight, CircleCheck, CopyDocument, Download, FullScreen, Printer, RefreshLeft, Search, TopRight, Warning, ZoomIn, ZoomOut } from "@element-plus/icons-vue";
import rawGuide from "@/content/deployment-guide.json";
import rawMedia from "@/content/deployment-media.json";
import { filterChapters, guideMarkdown, parseProgress } from "@/utils/tutorialGuide.mjs";
import type { DeploymentGuide, TutorialMedia } from "./types";
import TutorialFigure from "./TutorialFigure.vue";

const guide = rawGuide as DeploymentGuide;
const media = rawMedia as Record<string, TutorialMedia>;
const route = useRoute();
const router = useRouter();
const query = ref("");
const annotations = ref(true);
const allSteps = guide.chapters.flatMap(chapter => chapter.steps);
const progressKey = "pboot-deployment-guide-progress-v1";
const storageFailed = ref(false);
const completed = ref<string[]>([]);
try { completed.value = parseProgress(localStorage.getItem(progressKey), allSteps.map(step => step.id)); }
catch { storageFailed.value = true; }
watch(completed, value => { try { localStorage.setItem(progressKey, JSON.stringify(value)); } catch { storageFailed.value = true; } });
const percentage = computed(() => Math.round(completed.value.length / allSteps.length * 100));
const screenshotCount = Object.values(media).filter(item => item.kind === "screenshot").length;
const diagramCount = Object.values(media).length - screenshotCount;
const matchingChapters = computed(() => filterChapters(guide.chapters, query.value));
const activeChapter = computed(() => guide.chapters.find(chapter => chapter.id === route.query.chapter) || guide.chapters[0]!);
const activeIndex = computed(() => guide.chapters.indexOf(activeChapter.value));
const printMode = ref(false);
const printing = ref(false);
const renderedChapters = computed(() => printMode.value ? guide.chapters : [activeChapter.value]);
const imageVisible = ref(false);
const selectedMedia = ref<TutorialMedia>();
const zoom = ref(100);

async function selectChapter(id: string) {
  await router.replace({ query: { ...route.query, chapter: id } });
  await nextTick();
  document.querySelector<HTMLElement>(`#chapter-${id} h2`)?.focus({ preventScroll: true });
  document.querySelector(`#chapter-${id}`)?.scrollIntoView({ block: "start", behavior: "auto" });
}
function toggleStep(id: string, checked: boolean) {
  completed.value = checked ? [...new Set([...completed.value, id])] : completed.value.filter(value => value !== id);
}
async function reset() {
  try { await ElMessageBox.confirm("只清空当前浏览器的教程核对进度，不会修改服务器或业务数据。", "重置核对进度", { type: "warning", confirmButtonText: "重置进度", cancelButtonText: "取消" }); completed.value = []; }
  catch { /* Cancel keeps the existing progress. */ }
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); ElMessage.success("命令已复制，尚未执行"); }
  catch { ElMessage.warning("浏览器未允许复制，请在命令区域手动选择"); }
}
function openImage(id: string) { selectedMedia.value = media[id]; zoom.value = 100; imageVisible.value = true; }
function download() {
  const base = new URL(`${import.meta.env.BASE_URL}tutorial/deployment/`, window.location.origin).href;
  const blob = new Blob(["\uFEFF", guideMarkdown(guide, media, base)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `pboot-baota-guide-${guide.version}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const beforePrint = () => { printMode.value = true; };
const afterPrint = () => { printMode.value = false; printing.value = false; };
async function printGuide() {
  printing.value = true; printMode.value = true;
  await nextTick();
  try {
    const pictures = Array.from(document.querySelectorAll<HTMLImageElement>(".guide-reading .figure-image img"));
    await Promise.race([Promise.all(pictures.map(picture => picture.decode())), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000))]);
    window.print();
  } catch { afterPrint(); ElMessage.warning("部分图片尚未加载，未开始打印。请检查图片后重试。"); }
}
onMounted(() => { window.addEventListener("beforeprint", beforePrint); window.addEventListener("afterprint", afterPrint); });
onBeforeUnmount(() => { window.removeEventListener("beforeprint", beforePrint); window.removeEventListener("afterprint", afterPrint); });
</script>

<style scoped>
.deployment-tutorial { color: #263244; letter-spacing: 0; }
.guide-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.guide-eyebrow { color: #667085; font-size: 12px; font-weight: 600; }
h1 { font-size: 27px; line-height: 1.4; margin: 7px 0; }
.guide-header p { margin: 0; color: #667085; font-size: 14px; line-height: 1.7; }
.guide-actions { display: flex; gap: 8px; flex-shrink: 0; }
.guide-actions .el-button { margin: 0; width: 36px; height: 36px; padding: 0; }
.guide-meta { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 12px; color: #667085; margin: 20px 0 10px; }
.progress-label { margin-left: auto; font-weight: 600; color: #167150; }
.guide-progress { margin-bottom: 24px; }
.guide-workspace { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 32px; align-items: start; }
.guide-directory { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; padding-right: 20px; border-right: 1px solid #dce3eb; scrollbar-width: thin; }
.directory-summary { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #667085; padding: 12px 0; }
.chapter-link { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 62px; background: transparent; border: 0; border-left: 3px solid transparent; border-radius: 0; padding: 8px; text-align: left; color: #344054; font: inherit; font-size: 13px; cursor: pointer; }
.chapter-link:hover { background: #edf2f8; }
.chapter-link.selected { background: #eaf3ff; border-left-color: #1677ff; color: #165bb5; }
.chapter-link:focus-visible { outline: 2px solid #1677ff; outline-offset: -2px; }
.chapter-link small { display: block; font-size: 11px; color: #667085; margin-bottom: 3px; }
.chapter-number { font: 12px ui-monospace, monospace; color: #7b8596; flex: 0 0 21px; }
.chapter-complete { color: #21835b; margin-left: auto; flex-shrink: 0; }
.directory-footnote { padding: 16px 8px; font-size: 12px; color: #667085; line-height: 1.7; border-top: 1px solid #e4e7ec; }
.no-results { padding: 20px 8px; font-size: 13px; }
.guide-reading { min-width: 0; max-width: 1140px; }
.guide-scope { margin: 0 0 24px; font-size: 13px; line-height: 1.8; padding: 14px 18px; border-left: 3px solid #8293ab; background: #edf1f5; }
.guide-chapter { scroll-margin-top: 20px; }
.chapter-heading { padding-bottom: 22px; border-bottom: 1px solid #dce3eb; }
.chapter-heading > span { font-size: 12px; color: #167150; font-weight: 600; }
.chapter-heading h2 { font-size: 24px; line-height: 1.5; margin: 7px 0; }
.chapter-heading h2:focus { outline: none; }
.chapter-heading p { color: #667085; font-size: 14px; line-height: 1.8; margin: 0; }
.guide-step { padding: 24px 0; border-bottom: 1px solid #dce3eb; }
.guide-step h3 { display: flex; align-items: flex-start; gap: 12px; font-size: 18px; line-height: 1.6; margin: 0 0 14px; }
.step-number { flex: 0 0 26px; height: 26px; background: #e4edf7; border-radius: 4px; text-align: center; font-size: 14px; color: #345780; }
.guide-step p { margin: 12px 0; font-size: 14px; line-height: 1.95; overflow-wrap: anywhere; }
.step-warning { display: flex; align-items: flex-start; gap: 10px; border-left: 3px solid #dc6c26; background: #fff4ec; padding: 12px 16px; font-size: 13px; line-height: 1.8; color: #8f4218; margin: 18px 0; }
.step-warning .el-icon { margin-top: 4px; flex-shrink: 0; }
.command-block { border: 1px solid #d4dce5; border-radius: 6px; overflow: hidden; margin: 18px 0; background: #fff; }
.command-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 4px 12px; min-height: 36px; background: #edf1f5; font-size: 12px; color: #475467; }
.command-heading .el-button { flex-shrink: 0; }
.command-block pre { margin: 0; padding: 16px; overflow-x: auto; color: #293a4c; font-size: 12px; line-height: 1.8; tab-size: 2; }
.step-check { display: flex; gap: 10px; align-items: flex-start; padding-top: 12px; font-size: 13px; line-height: 1.8; color: #167150; cursor: pointer; }
.step-check input { flex-shrink: 0; width: 16px; height: 16px; margin: 4px 0 0; accent-color: #21835b; }
.chapter-pagination { display: flex; align-items: center; justify-content: space-between; padding: 24px 0; font-size: 13px; color: #667085; }
.guide-references { padding: 18px 0; border-top: 1px solid #dce3eb; font-size: 12px; color: #667085; line-height: 1.8; }
.guide-references h3 { font-size: 14px; }
.guide-references a { display: inline-flex; align-items: center; gap: 5px; margin: 0 20px 10px 0; color: #1762c4; text-decoration: none; }
.image-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.image-controls .el-button { margin: 0; }
.image-scroll { max-height: 73vh; overflow: auto; background: #f2f4f7; }
.image-scroll :deep(.tutorial-figure) { margin: 0; }
@media (min-width: 1700px) { .guide-workspace { gap: 42px; } }
@media (max-width: 1050px) { .guide-workspace { grid-template-columns: 215px minmax(0, 1fr); gap: 22px; } .guide-directory { padding-right: 12px; } }
@media (max-width: 760px) { .guide-header { align-items: flex-start; flex-direction: column; gap: 12px; } .guide-workspace { display: block; } .guide-directory { position: static; border-right: 0; max-height: 290px; padding: 0 0 12px; margin-bottom: 24px; border-bottom: 1px solid #dce3eb; } .guide-directory nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .directory-footnote { display: none; } .progress-label { margin-left: 0; } .chapter-heading h2 { font-size: 22px; } .guide-scope { padding: 12px; } .guide-step h3 { font-size: 17px; } .image-controls { flex-wrap: wrap; } }
</style>

<style>
@media print {
  @page pboot-tutorial { size: A4; margin: 14mm 12mm; }
  .deployment-tutorial { page: pboot-tutorial; }
  body:has(.deployment-tutorial) .el-aside, body:has(.deployment-tutorial) .el-header, body:has(.deployment-tutorial) .tool-nav, body:has(.deployment-tutorial) .el-overlay { display: none !important; }
  body:has(.deployment-tutorial) .layout-shell, body:has(.deployment-tutorial) .content-shell { display: block !important; }
  body:has(.deployment-tutorial) .el-main { padding: 0 !important; background: white !important; }
  .deployment-tutorial .guide-directory, .deployment-tutorial .guide-actions, .deployment-tutorial .guide-progress, .deployment-tutorial .chapter-pagination, .deployment-tutorial .command-heading .el-button { display: none !important; }
  .deployment-tutorial .guide-workspace { display: block !important; }
  .deployment-tutorial .guide-reading { max-width: none !important; }
  .deployment-tutorial .guide-chapter { break-before: page; }
  .deployment-tutorial .guide-chapter:first-of-type { break-before: auto; }
  .deployment-tutorial .guide-step h3 { break-after: avoid; }
  .deployment-tutorial .command-block pre { white-space: pre-wrap !important; overflow-wrap: anywhere; }
  .deployment-tutorial .guide-header, .deployment-tutorial .guide-meta { color: #111 !important; }
}
</style>
