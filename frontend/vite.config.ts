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
