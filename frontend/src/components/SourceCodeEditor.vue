<template>
  <div class="source-editor">
    <div class="editor-toolbar">
      <div class="toolbar-title">
        <el-tag size="small" type="info">HTML源码</el-tag>
        <span>{{ placeholder }}</span>
      </div>
      <div class="toolbar-actions">
        <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="handleImageSelected" />
        <el-button size="small" @click="formatSourceCode">格式化</el-button>
        <el-button size="small" type="primary" :loading="uploading" @click="fileInput?.click()">
          <el-icon><Picture /></el-icon>
          插入图片
        </el-button>
        <el-switch v-model="showPreview" active-text="预览" inactive-text="源码" />
      </div>
    </div>

    <div ref="editorHost" class="editor-host" />

    <div v-if="showPreview" class="preview-panel">
      <div v-if="model" class="preview-content" v-html="previewHtml" />
      <el-empty v-else description="暂无可预览内容" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { html } from "@codemirror/lang-html";
import { ElMessage } from "element-plus";
import { getImageUploadSizeError, getUploadUrl, normalizeHtmlImageUrls, uploadImages } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";

const model = defineModel<string>({ required: true });

defineProps<{
  placeholder: string;
}>();

const editorHost = ref<HTMLDivElement>();
const fileInput = ref<HTMLInputElement>();
const showPreview = ref(false);
const uploading = ref(false);
const previewHtml = computed(() => normalizeHtmlImageUrls(model.value || ""));
let editorView: EditorView | undefined;

const insertAtCursor = (text: string) => {
  if (!editorView) return;
  const selection = editorView.state.selection.main;
  editorView.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
  });
  editorView.focus();
};

const replaceEditorContent = (text: string) => {
  if (!editorView) {
    model.value = text;
    return;
  }
  const currentValue = editorView.state.doc.toString();
  editorView.dispatch({
    changes: { from: 0, to: currentValue.length, insert: text },
  });
  model.value = text;
  editorView.focus();
};

const formatHtmlForEditing = (value: string) => {
  const raw = value.trim();
  if (!raw) return "";

  const blockTags = [
    "h[1-6]",
    "p",
    "div",
    "section",
    "article",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
  ].join("|");

  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/>\s+</g, "><")
    .replace(new RegExp(`(<(?:${blockTags})(?:\\s[^>]*)?>)`, "gi"), "\n$1")
    .replace(new RegExp(`(<\\/(?:${blockTags})>)`, "gi"), "$1\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
};

const formatSourceCode = () => {
  const currentValue = editorView?.state.doc.toString() ?? model.value;
  const formatted = formatHtmlForEditing(currentValue || "");
  replaceEditorContent(formatted);
  ElMessage.success("源码已格式化");
};

const handleImageSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const sizeError = getImageUploadSizeError(file);
  if (sizeError) {
    ElMessage.warning(sizeError);
    input.value = "";
    return;
  }

  const formData = new FormData();
  formData.append("imgArr", file);

  uploading.value = true;
  try {
    const res = await uploadImages(formData);
    const filename = res.data[0];
    if (!filename) throw new Error("上传接口没有返回文件名");
    const url = getUploadUrl(filename);
    insertAtCursor(`\n<p><img src="${url}" alt="${file.name}" style="max-width:100%;" /></p>\n`);
    ElMessage.success("图片已插入正文");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "图片插入失败"));
  } finally {
    uploading.value = false;
    input.value = "";
  }
};

const createEditor = () => {
  if (!editorHost.value) return;

  editorView = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: model.value || "",
      extensions: [
        basicSetup,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        html(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            model.value = update.state.doc.toString();
          }
        }),
      ],
    }),
  });
};

watch(
  () => model.value,
  (nextValue) => {
    if (!editorView) return;
    const currentValue = editorView.state.doc.toString();
    if (nextValue === currentValue) return;
    editorView.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: nextValue || "",
      },
    });
  },
);

onMounted(createEditor);

onBeforeUnmount(() => {
  editorView?.destroy();
});
</script>

<style scoped>
.source-editor {
  overflow: hidden;
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
}

.editor-toolbar {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid var(--el-border-color-light);
}

.toolbar-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-regular);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hidden-input {
  display: none;
}

.editor-host {
  min-height: 420px;
}

.preview-panel {
  padding: 18px;
  border-top: 1px solid var(--el-border-color-light);
  background: #fff;
}

.preview-content {
  color: #344054;
  line-height: 1.8;
}

.preview-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 14px auto;
  border-radius: 6px;
}

.preview-content :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}

:deep(.cm-editor) {
  min-height: 420px;
  font-size: 14px;
}

:deep(.cm-focused) {
  outline: none;
}

:deep(.cm-content) {
  font-family: Consolas, "Courier New", monospace;
}
</style>
