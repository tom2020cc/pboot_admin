import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["legacy-js-api"],
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 950,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("node_modules")) return;
        warn(warning);
      },
      output: {
        manualChunks: {
          "vue-core": ["vue", "vue-router", "pinia", "axios"],
          "element-plus": ["element-plus"],
          "element-icons": ["@element-plus/icons-vue"],
          "code-editor": [
            "codemirror",
            "@codemirror/commands",
            "@codemirror/lang-html",
            "@codemirror/state",
            "@codemirror/view",
          ],
        },
      },
    },
  },
    // 服务器相关配置
    // server: {
    //   proxy: {
    //     '/api': {
    //       target: ' http://localhost:3000', //跨域地址
    //       changeOrigin: true, //支持跨域
    //       rewrite: (path) => path.replace(/^\/api/, '') //重写路径,替换/api
    //     }
    //   }
    // }
})
