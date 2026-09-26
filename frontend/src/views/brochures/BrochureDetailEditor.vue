<template>
  <div class="detail-editor">
    <div class="detail-toolbar">
      <el-radio-group v-model="mode" size="small" aria-label="正文编辑模式"><el-radio-button value="source">HTML 源码</el-radio-button><el-radio-button value="preview">正文预览</el-radio-button></el-radio-group>
      <el-button :icon="Picture" :disabled="disabled" :loading="uploading" @click="fileInput?.click()">插入图片</el-button>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" hidden @change="upload" />
    </div>
    <div v-show="mode === 'source'" ref="host" class="source-host" />
    <iframe v-if="mode === 'preview'" :srcdoc="preview" sandbox="" title="产品详情正文预览" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { Picture } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { uploadImages, validateImageUploadFiles } from '@/api/uploads';
import { getErrorMessage } from '@/utils/request';
import { brochureImageUrl } from '@/utils/brochure';
import { mapDetailImages } from '@/utils/brochure-detail';

const model = defineModel<string>({ default: '' });
const props = defineProps<{ disabled: boolean; siteBase: string; language: string }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const host = ref<HTMLDivElement>();
const fileInput = ref<HTMLInputElement>();
const mode = ref('source');
const uploading = ref(false);
const readOnly = new Compartment();
let editor: EditorView | undefined;
const preview = computed(() => `<!doctype html><html dir="${props.language === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.7 Arial,sans-serif;padding:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #ddd;padding:8px}pre{white-space:pre-wrap}</style><body>${mapDetailImages(model.value, src => brochureImageUrl(src, props.siteBase))}</body></html>`);
onMounted(() => {
  if (!host.value) return;
  editor = new EditorView({ parent: host.value, state: EditorState.create({ doc: model.value, extensions: [basicSetup, html(), EditorView.lineWrapping,
    readOnly.of(EditorState.readOnly.of(props.disabled)),
    EditorView.contentAttributes.of({ 'aria-label': '产品详情 HTML 正文' }),
    EditorView.updateListener.of(update => { if (update.docChanged) model.value = update.state.doc.toString(); }),
  ] }) });
});
watch(() => props.disabled, value => editor?.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) }));
watch(model, value => { if (editor && value !== editor.state.doc.toString()) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); });
onBeforeUnmount(() => editor?.destroy());
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || props.disabled) return;
  const error = validateImageUploadFiles([file]);
  if (error) { ElMessage.warning(error); input.value = ''; return; }
  uploading.value = true; emit('busy', true);
  const position = editor?.state.selection.main.head ?? model.value.length;
  try {
    const data = new FormData(); data.append('imgArr', file);
    const src = (await uploadImages(data)).data[0];
    if (!src) throw new Error('上传未返回图片地址');
    const img = document.createElement('img'); img.setAttribute('src', src); img.alt = '';
    const insert = `\n<p>${img.outerHTML}</p>\n`;
    editor?.dispatch({ changes: { from: Math.min(position, editor.state.doc.length), insert } });
    mode.value = 'source';
  } catch (error) { ElMessage.error(getErrorMessage(error)); }
  finally { uploading.value = false; emit('busy', false); input.value = ''; }
}
</script>

<style scoped>
.detail-editor{border:1px solid #dce3e9;border-radius:6px;overflow:hidden;margin-bottom:20px}.detail-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px;background:#f7f9fb}.source-host{min-height:380px;max-height:650px;overflow:auto}.source-host :deep(.cm-editor){min-height:380px;font-size:13px}.detail-editor iframe{width:100%;height:520px;border:0}
</style>
