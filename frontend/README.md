# 管理后台前端（Vue 3）

PbootCMS 集中多站点管理系统的管理界面（SPA）。项目总览与启动脚本见[根目录 README](../README.md)。

## 技术栈

Vue 3 + Vite 5 + TypeScript + Element Plus + Pinia + vue-router；HTML 编辑使用 CodeMirror 6，报价单排版使用 paged.js。

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:5278
```

按需复制 `.env.example`：`VITE_API_BASE_URL` 指向后端（默认 `http://localhost:5108`），其余端口变量见模板内注释。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | Vite 开发服务器（默认 5278） |
| `pnpm build` | 类型检查（vue-tsc）+ 构建到 `dist/` |
| `pnpm preview` | 预览构建产物 |

## 说明

- 日常启动建议直接用根目录 `start.cmd`，无需手动进入本目录。
- `pnpm build` 产物 `dist/` 在生产环境由 Nginx 提供（模板见根目录 `deploy/nginx/`）。
