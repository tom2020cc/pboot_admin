<template>
  <section class="document-preview">
    <div class="document-preview-bar">
      <strong>{{ title }}</strong><span role="status">{{ status }}</span>
      <el-tooltip content="重新排版"><el-button circle :icon="Refresh" aria-label="重新排版" @click="refresh" /></el-tooltip>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <iframe v-if="source" :key="sequence" ref="frame" :srcdoc="source" :title="title" sandbox="allow-scripts" referrerpolicy="no-referrer" />
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
const props = defineProps<{ title: string; paperLabel?: string; render: (token: string) => string }>();
const frame = ref<HTMLIFrameElement>();
const source = ref('');
const sequence = ref(0);
const status = ref('等待排版');
const error = ref('');
let token = '', debounce: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
function refresh() {
  clearTimeout(debounce); clearTimeout(watchdog);
  token = crypto.randomUUID(); sequence.value++;
  error.value = ''; status.value = '正在排版';
  try { source.value = props.render(token); }
  catch (e) { fail(e instanceof Error ? e.message : '预览生成失败'); return; }
  watchdog = setTimeout(() => fail('排版超时，请点击重新排版。'), 150000);
}
function fail(message: string) {
  clearTimeout(watchdog); error.value = message; status.value = '排版失败'; source.value = '';
}
function receive(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || event.data?.type !== 'quotation-pagination' || event.data.token !== token) return;
  const data = event.data;
  if (data.state === 'ready') { clearTimeout(watchdog); status.value = data.continuous ? `${props.paperLabel || '连续长页'} · 高 ${Math.ceil(data.heightMm)} mm` : `${props.paperLabel || '报价单'} · ${data.pages} 页`; }
  else if (data.state === 'error') fail(data.phase === 'images' ? `第 ${data.imageIndex || 1} 张图片加载失败，请检查图片后重新排版。` : (data.message || '排版失败，请检查内容后重新排版。'));
  else if (data.state === 'progress') status.value = data.phase === 'images' ? `加载图片 ${data.done || 0}/${data.total || 0}${data.retry ? ' · 重试中' : ''}` : data.phase === 'fonts' ? '加载字体' : '正在排版';
}
watch(() => props.render, () => { clearTimeout(debounce); debounce = setTimeout(refresh, 600); });
onMounted(() => { window.addEventListener('message', receive); refresh(); });
onBeforeUnmount(() => { clearTimeout(debounce); clearTimeout(watchdog); window.removeEventListener('message', receive); });
</script>

<style scoped>
.document-preview { min-width:0; }
.document-preview-bar { display:flex; align-items:center; gap:12px; padding:0 0 12px; font-size:13px; }
.document-preview-bar span { margin-inline-start:auto; color:var(--el-text-color-secondary); }
iframe { display:block; width:100%; height:calc(100vh - 230px); min-height:540px; border:1px solid var(--el-border-color-light); background:#e9edf1; }
@media(max-width:760px) { iframe { min-height:480px; height:70vh; } }
</style>
