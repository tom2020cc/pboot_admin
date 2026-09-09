# PbootCMS 集中多站点管理系统

一套服务集中管理多个 PbootCMS 网站，包含 NestJS + Vue3 管理后台、SEO 收录工具和 FTP 发布/安全巡检工具。支持内容多语言翻译、SEO 优化、sitemap、Google/Yandex 收录提交、视频与报价单管理。

> ⚠️ 本仓库是「干净可移植包」，已排除所有密钥与本地数据（API Key、Google 服务账号私钥、FTP 密码、IndexNow Key、本地 SQLite 库等）。部署后需按下方说明自行配置。

## 技术栈

| 组件 | 技术 |
|---|---|
| 管理后台后端 | NestJS + TypeORM + SQL.js（本地 sqlite，无需 MySQL） |
| 管理后台前端 | Vue 3 + Vite + Element Plus + TypeScript |
| SEO 工具 | 原生 Node.js http 服务 + 原生 HTML/JS（无框架） |
| FTP 工具 | 原生 Node.js http 服务 + 原生 HTML/JS |

## 目录结构

```
pboot_admin_backup_xxxx/
├── backend/              # NestJS 后端（多语言翻译、SEO 优化、视频、菜单、新闻、产品、单页、图片上传）
│   ├── src/              #   源码
│   └── .env.example      #   环境变量模板（复制为 .env 后填写）
├── frontend/             # Vue3 前端（管理界面）
│   ├── src/
│   └── .env.example
├── tools/
│   ├── seo_publish_tool/ # SEO 收录工具（sitemap/robots、Google Indexing、Yandex/IndexNow、AI SEO 修复）
│   │   └── ai.config.example.json
│   ├── ftp_publish_tool/ # FTP 发布工具
│   └── config_wizard/    # 旧版兼容代码，集中版日常不再启动
├── managed-sites/        # 每个受管网站独立的配置、接口、状态与备份目录
├── docs/                 # 文档
├── *.cmd                 # Windows 一键脚本（安装/站点管理/启动/停止）
└── README_FIRST.md       # 上手说明
```

## 端口表

| 服务 | 端口 |
|---|---|
| 管理后台后端 | 5108（`backend/.env` 的 `BACKEND_PORT`） |
| 管理后台前端 | 5278 |
| SEO 工具 | 5388 |
| FTP 工具 | 5389 |

## 部署步骤

Linux 宝塔生产部署请优先阅读：[宝塔集中部署图文教程](docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md)。项目同时提供 `deploy/` 下的 PM2、Nginx、生产环境变量和健康检查模板。

1. **安装依赖**：双击 `00-install.cmd`（或 `pnpm install`）。
2. **配置**：首次启动会自动生成 `backend/.env`。模型 Key 在模型配置页统一填写；各网站路径、数据库、网址和 YouTube 频道 ID 在站点管理中填写。
3. **启动**：双击 `07-start-all.cmd`（后端使用可见常驻终端，前端、SEO、FTP 在后台运行），或单独运行 `02-start.cmd` / `05-start-seo-tool.cmd` / `06-start-ftp-tool.cmd`。
4. **创建管理员**：双击 `03-create-admin.cmd`。
5. 访问前端 `http://localhost:5278`、SEO 工具 `http://localhost:5388`。

## 脚本速查

| 脚本 | 作用 |
|---|---|
| `00-install.cmd` | 安装前后端依赖 |
| `01-sites.cmd` | 启动服务并打开集中站点管理 |
| `02-start.cmd` | 启动管理后台（后端可见终端 + 前端后台） |
| `03-create-admin.cmd` | 创建管理员账号 |
| `04-stop-ports.cmd` | 停止所有相关端口 |
| `05-start-seo-tool.cmd` | 启动 SEO 收录工具 |
| `06-start-ftp-tool.cmd` | 启动 FTP 发布工具 |
| `07-start-all.cmd` | 启动日常四项服务 |

## 包含 / 排除清单

**包含**：全部源码（backend/src、frontend/src、tools 各工具的 js/html）、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、tsconfig/vite 配置、`docs/`、`.cmd` 脚本、`.env.example` / `ai.config.example.json` 等模板。

**排除**：`node_modules/`、`dist/`、`*.log`、`*.sqlite` / `*.db`（本地库）、`backend/.env`、`frontend/.env.local`、`managed-sites/*/`（每站 Key、FTP、Google、上传文件和断点）、`tools/*/ai.config.json`、`backups/`、`tools/*/logs/`。

## 常见问题

- **模型显示「未配置」**：在 `backend/.env` 填入对应厂商的 API Key，或在 SEO 工具页「配置 AI API Key」面板直接粘贴保存（保存即生效）。
- **Google Indexing 提交 403**：服务账号不是 Search Console 该资源的所有者，需在 Search Console「设置 → 用户和权限」把服务账号邮箱加为「完整/所有者」。
- **本地库损坏**：强制 kill 后端进程若撞上 sql.js autoSave 会写坏 `backend/dev.sqlite`，用 `backend/dev.before_*.sqlite` 备份恢复。
