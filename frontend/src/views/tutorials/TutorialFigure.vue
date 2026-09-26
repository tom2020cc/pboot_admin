<template>
  <figure class="tutorial-figure">
    <div class="figure-toolbar">
      <span>{{ media.kind === 'screenshot' ? `实操截图 · ${media.date || '2026-09-11'}` : 'SVG 示意图' }}</span>
      <el-tooltip v-if="!expanded" content="放大查看" placement="top">
        <el-button text :icon="ZoomIn" :aria-label="`放大：${media.caption}`" @click="$emit('expand')" />
      </el-tooltip>
    </div>
    <div class="figure-image" :class="{ 'image-failed': failed }">
      <img :src="src" :alt="media.caption" :loading="eager ? 'eager' : 'lazy'" decoding="async" @load="failed = false" @error="failed = true" />
      <svg v-if="!failed && annotations && media.arrows?.length" class="annotations" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker :id="markerId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="2" markerHeight="2" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 1 L10 5 L0 9Z" fill="#e3363c" /></marker></defs>
        <path v-for="(arrow, index) in media.arrows" :key="index" :d="`M${arrow.from.join(' ')} L${arrow.to.join(' ')}`" stroke="#e3363c" stroke-width="0.35" fill="none" :marker-end="`url(#${markerId})`" />
      </svg>
      <template v-if="!failed && annotations">
        <span v-for="(arrow, index) in media.arrows" :key="index" class="annotation-number" :style="{left: `${arrow.from[0]}%`, top: `${arrow.from[1]}%`}" aria-hidden="true">{{ index + 1 }}</span>
      </template>
      <div v-if="failed" class="figure-error" role="status">图片未加载，请检查教程素材是否完整部署。<el-button text :icon="Refresh" @click="retry">重试</el-button></div>
    </div>
    <figcaption>
      <strong>{{ media.caption }}</strong>
      <ol v-if="media.arrows?.length" class="annotation-legend"><li v-for="(arrow, index) in media.arrows" :key="index">{{ arrow.label }}</li></ol>
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, ref } from "vue";
import { Refresh, ZoomIn } from "@element-plus/icons-vue";
import type { TutorialMedia } from "./types";
const props = withDefaults(defineProps<{ media: TutorialMedia; annotations?: boolean; expanded?: boolean; eager?: boolean }>(), { annotations: true, expanded: false, eager: false });
defineEmits<{ expand: [] }>();
const failed = ref(false);
const revision = ref(0);
const markerId = `tutorial-arrow-${getCurrentInstance()?.uid}`;
const src = computed(() => `${import.meta.env.BASE_URL}tutorial/deployment/${props.media.file}${revision.value ? `?retry=${revision.value}` : ''}`);
const retry = () => { revision.value++; };
</script>

<style scoped>
.tutorial-figure { margin: 22px 0; min-width: 0; }
.figure-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 34px; font-size: 12px; color: #667085; border-bottom: 1px solid #e4e7ec; }
.figure-image { position: relative; width: 100%; background: #fff; }
.figure-image img { display: block; width: 100%; height: auto; }
.annotations { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.annotation-number { position: absolute; display: grid; place-items: center; transform: translate(-50%, -50%); width: 24px; height: 24px; border: 2px solid white; border-radius: 50%; background: #d92d36; color: #fff; font-size: 12px; font-weight: 700; pointer-events: none; box-shadow: 0 1px 4px #0003; }
figcaption { font-size: 13px; line-height: 1.7; padding: 12px 0; color: #475467; border-bottom: 1px solid #e4e7ec; }
figcaption strong { font-weight: 500; }
.annotation-legend { margin: 8px 0 0; padding-left: 24px; }
.annotation-legend li { padding: 2px 0; }
.annotation-legend li::marker { color: #b4232e; font-weight: 700; }
.image-failed { min-height: 150px; }
.figure-error { padding: 28px; text-align: center; color: #b42318; }
@media print { .figure-toolbar .el-button { display: none; } .tutorial-figure { break-inside: avoid; } .annotation-number { print-color-adjust: exact; } }
</style>
