<template>
  <main class="environment-guide">
    <header class="guide-heading">
      <div><span class="guide-eyebrow">PBOOT ADMIN CENTER · 运行与发布</span><h1>{{ guide.title }}</h1><p>{{ guide.summary }}</p></div>
      <div class="guide-buttons">
        <el-tooltip content="返回管理后台"><el-button :icon="Back" aria-label="返回管理后台" @click="router.push('/')" /></el-tooltip>
        <el-tooltip content="下载配置与部署教程"><el-button :icon="Download" aria-label="下载配置与部署教程" @click="download" /></el-tooltip>
      </div>
    </header>
    <ToolNav active-id="tutorial" />
    <p class="guide-basis">{{ guide.basis }} · 更新 {{ guide.version }}</p>
    <nav class="guide-index" aria-label="教程章节"><a href="#/environment-guide" @click.prevent="scrollToSection('environment-comparison')">配置对照</a><a v-for="(section, index) in guide.sections" :key="section.title" href="#/environment-guide" @click.prevent="scrollToSection(`environment-section-${index}`)">{{ section.title }}</a></nav>
    <section id="environment-comparison" class="comparison" aria-label="本地与宝塔配置对照">
      <div class="comparison-heading"><span>配置项目</span><strong class="local-label"><el-icon><Monitor /></el-icon>本地调试</strong><strong class="baota-label"><el-icon><Cloudy /></el-icon>宝塔线上</strong></div>
      <div v-for="row in guide.comparisons" :key="row.item" class="comparison-row">
        <h2>{{ row.item }}</h2><p><small class="local-label">本地</small>{{ row.local }}</p><p><small class="baota-label">宝塔</small>{{ row.baota }}</p><div class="comparison-note">{{ row.note }}</div>
      </div>
    </section>
    <section v-for="(section, index) in guide.sections" :id="`environment-section-${index}`" :key="section.title" class="guide-section">
      <h2><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ section.title }}</h2>
      <p v-for="paragraph in section.body" :key="paragraph">{{ paragraph }}</p>
      <ol v-if="section.steps.length"><li v-for="step in section.steps" :key="step">{{ step }}</li></ol>
      <div v-for="command in section.commands" :key="command.label" class="command-block"><strong>{{ command.label }}</strong><pre><code>{{ command.code }}</code></pre></div>
    </section>
    <footer><h2>官方参考</h2><a v-for="reference in guide.references" :key="reference.url" :href="reference.url" target="_blank" rel="noopener noreferrer">{{ reference.title }}<el-icon><TopRight /></el-icon></a></footer>
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Back, Cloudy, Download, Monitor, TopRight } from '@element-plus/icons-vue';
import ToolNav from '@/components/layout/ToolNav.vue';
import guide from '@/content/environment-guide.json';
import { environmentGuideMarkdown } from '@/utils/environmentGuide.mjs';
const router = useRouter();
function scrollToSection(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function download() {
  const url = URL.createObjectURL(new Blob(['\uFEFF', environmentGuideMarkdown(guide)], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = '本地与宝塔配置及发布教程.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<style scoped>
.environment-guide{max-width:1180px;margin:auto;padding:34px 28px 60px;background:#fff;color:#263244;line-height:1.8;letter-spacing:0}
.guide-heading{display:flex;align-items:flex-start;gap:24px;justify-content:space-between}.guide-heading>div:first-child{min-width:0}.guide-eyebrow{font-size:12px;color:#657184}.guide-heading h1{font-size:28px;line-height:1.3;margin:8px 0 14px}.guide-heading p{margin:0;color:#536173}.guide-buttons{display:flex;flex-shrink:0;gap:8px}.guide-buttons .el-button{margin:0;width:36px;height:36px;padding:0}
.guide-basis{font-size:12px;color:#657184;padding:14px 0;border-bottom:1px solid #e2e7ed}.guide-index{display:flex;flex-wrap:wrap;gap:7px 22px;margin:20px 0 30px}.guide-index a{color:#1468b7;text-underline-offset:4px;font-size:13px}
.comparison-heading,.comparison-row{display:grid;grid-template-columns:150px minmax(0,1fr) minmax(0,1fr);gap:0 20px}.comparison-heading{padding:14px 16px;background:#f4f6f8;border-top:1px solid #dce3e9;border-bottom:1px solid #dce3e9}.comparison-heading strong{display:flex;align-items:center;gap:8px}.local-label{color:#126653}.baota-label{color:#a32d32}.comparison-row{padding:18px 16px;border-bottom:1px solid #e2e7ed}.comparison-row h2{font-size:14px;margin:0}.comparison-row p{font-size:13px;margin:0;overflow-wrap:anywhere}.comparison-row small{display:none}.comparison-note{grid-column:2/-1;font-size:12px;color:#687588;padding-top:9px;overflow-wrap:anywhere}
.guide-section{padding:28px 0;border-bottom:1px solid #e2e7ed;scroll-margin-top:95px}.guide-section h2,footer h2{font-size:20px;margin:0 0 16px;line-height:1.5}.guide-section h2 span{font-size:13px;margin-right:12px;color:#167c67}.guide-section p,.guide-section li{font-size:14px;overflow-wrap:anywhere}.guide-section li{padding-left:5px;margin-bottom:12px}.guide-section ol{padding-left:22px}.command-block{margin-top:18px;border-left:3px solid #167c67;padding:12px 16px;background:#f4f6f8}.command-block strong{font-size:12px;color:#526274}.command-block pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin:10px 0;font-family:Consolas,monospace}footer{padding-top:30px}footer a{display:flex;align-items:center;gap:8px;color:#1468b7;font-size:13px;margin:8px 0}.comparison{scroll-margin-top:95px}
@media(max-width:640px){.environment-guide{padding:24px 14px 40px}.guide-heading{gap:12px}.guide-heading h1{font-size:23px}.guide-heading p{font-size:13px}.guide-eyebrow{font-size:10px}.guide-buttons{gap:4px}.guide-buttons .el-button{width:30px;height:30px}.comparison-heading{grid-template-columns:1fr 1fr;padding:12px}.comparison-heading>span{display:none}.comparison-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 14px;padding:16px 12px}.comparison-row h2{grid-column:1/-1}.comparison-note{grid-column:1/-1;padding:0}.comparison-row small{display:block;font-size:11px;font-weight:700;margin-bottom:3px}.guide-section h2{font-size:18px}.guide-section{scroll-margin-top:115px}.guide-index{gap:9px 18px}}
</style>
