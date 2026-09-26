# PbootCMS 集中多站点管理系统

一套服务集中管理多个 PbootCMS 网站，包含 NestJS + Vue3 管理后台、SEO 收录工具和 FTP 发布/安全巡检工具。支持内容多语言翻译、SEO 优化、sitemap、Google/Yandex 收录提交、视频与报价单管理。

> ⚠️ 本仓库是「干净可移植包」，已排除所有密钥与本地数据（API Key、Google 服务账号私钥、FTP 密码、IndexNow Key、本地 SQLite 库等）。部署后需按下方说明自行配置。

## 技术栈

| 组件 | 技术 |
| --- | --- |
| 管理后台后端 | NestJS + TypeORM + SQL.js（本地 sqlite，无需 MySQL） |
| 管理后台前端 | Vue 3 + Vite + Element Plus + TypeScript |
| PDF 生成 | Playwright Chromium（报价单 / 产品手册） |
| SEO 工具 | 原生 Node.js http 服务 + 原生 HTML/JS（无框架） |
| FTP 工具 | 原生 Node.js http 服务 + 原生 HTML/JS |

## 目录结构

```text
pboot_admin_center/
├── backend/              # NestJS 后端（多语言翻译、SEO 优化、视频、菜单、新闻、产品、单页、图片上传）
│   ├── src/              #   源码
│   └── .env.example      #   环境变量模板（复制为 .env 后填写）
├── frontend/             # Vue3 前端（管理界面）
│   ├── src/
│   └── .env.example
├── tools/
│   ├── seo_publish_tool/     # SEO 收录工具（sitemap/robots、Google Indexing、Yandex/IndexNow、AI SEO 修复）
│   │   └── ai.config.example.json
│   ├── ftp_publish_tool/     # FTP 发布工具
│   ├── seo-content-worker/   # 独立 SEO 内容写作进程（生产中由 PM2 托管）
│   └── config_wizard/        # 旧版兼容代码，集中版日常不再启动
├── deploy/               # 宝塔生产部署：PM2、Nginx、生产环境变量与健康检查模板
├── managed-sites/        # 每个受管网站独立的配置、接口、状态与备份目录
├── docs/                 # 文档
├── *.cmd                 # Windows 一键脚本（安装/站点管理/启动/停止）
└── README_FIRST.md       # 上手说明
```

## 端口表

| 服务 | 端口 |
| --- | --- |
| 管理后台后端 | 5108（`backend/.env` 的 `BACKEND_PORT`） |
| 管理后台前端 | 5278 |
| SEO 工具 | 5388 |
| FTP 工具 | 5389 |

## 部署步骤（本地 Windows）

环境要求：Node.js ≥ 22.12 LTS，pnpm 9（`install.cmd` 会在缺失时自动安装 pnpm 9.15.4）。

1. **安装依赖**：双击 `install.cmd`（或 `pnpm install`）。
2. **配置**：首次启动会自动生成 `backend/.env`。模型 Key 在模型配置页统一填写；各网站路径、数据库、网址和 YouTube 频道 ID 在站点管理中填写。
3. **启动**：双击 `start.cmd`（后端使用可见常驻终端，前端、SEO、FTP 在后台运行）。
4. **创建管理员**：双击 `create-admin.cmd`（仅限本地/非生产环境；生产环境公开注册已关闭，首管理员改用 `deploy/bootstrap-admin.cjs` 创建，凭据写入 `/root/pboot-admin-initial-login.json`）。
5. 访问前端 `http://localhost:5278`、SEO 工具 `http://localhost:5388`。

## 生产部署（宝塔）速查

完整图文教程见 [宝塔集中部署图文教程](docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md)（英文版 [docs/deployment.md](docs/deployment.md)），`deploy/` 目录提供全部模板：

| 文件 / 目录 | 作用 |
| --- | --- |
| `prepare-baota.sh` | 首次安装：校验 Node ≥ 22.12、安装 pnpm、生成 `backend/.env`（随机密钥）并构建 |
| `baota.ecosystem.config.js` | 4 个 PM2 进程：管理 API、SEO 工具、FTP 工具、SEO 内容进程 |
| `register-baota-pm2.cjs` | 把上述进程注册进宝塔 PM2 面板（不重启进程） |
| `bootstrap-admin.cjs` | 创建生产环境首管理员（后端停止时直接写入 SQLite） |
| `nginx/` | Nginx 反向代理、内网回环、生产防护与 PbootCMS 伪静态模板 |
| `baota-health-check.sh` | 部署后文件与回环端口自检 |
| `verify-production.cjs` | 生产验收：HTTPS 跳转、登录页、匿名 API 拒绝、登录/登出 |
| `configure-public-urls.cjs` | 配置公网访问地址（管理 / SEO / FTP 三个域名） |

## 脚本速查

| 脚本 | 作用 |
| --- | --- |
| `install.cmd` | 安装前后端依赖 |
| `create-admin.cmd` | 创建管理员账号（本地/非生产环境） |
| `stop.cmd` | 停止所有相关端口 |
| `start.cmd` | 启动日常四项服务 |
| `seo-content.cmd` | 启动 SEO 内容写作进程（独立于后端，需配置 `SEO_WORKER_TOKEN`） |

## 开发与测试

- 后端：`backend/` 下 `pnpm start:dev` 启动开发模式（默认 5108），`pnpm test` 运行 Jest 单元测试（spec 与源码同目录）。
- 前端：`frontend/` 下 `pnpm dev` 启动 Vite 开发服务器（5278），`pnpm build` 含 `vue-tsc` 类型检查。
- 部署与工具脚本：`node --test deploy/*.test.cjs tools/*.test.cjs`。

## 文档索引

- [README_FIRST.md](README_FIRST.md) — 新电脑快速上手
- [docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md](docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md) — 宝塔集中部署图文教程
- [docs/BAOTA_SYNC_ZH.md](docs/BAOTA_SYNC_ZH.md) — 本地 → 宝塔同步（FTP 工具宝塔同步页）
- [docs/deployment.md](docs/deployment.md) — 部署与端口说明（英文）
- [docs/NEW_PC_SETUP_ZH.md](docs/NEW_PC_SETUP_ZH.md) — 新电脑集中版安装教程
- [docs/PORTS_AND_INSTANCES.md](docs/PORTS_AND_INSTANCES.md) — 四个集中端口与实例说明
- [docs/LOCAL_BAOTA_WORKFLOW_ZH.md](docs/LOCAL_BAOTA_WORKFLOW_ZH.md) — 本地 phpStudy 与宝塔环境对照、本地优先工作流
- [managed-sites/README.md](managed-sites/README.md) — 每站配置目录结构
- [docs/PROJECT_BASELINE_20260909_ZH.md](docs/PROJECT_BASELINE_20260909_ZH.md) — 2026-09-09 开发基线

更多功能文档（菜单、产品、报价单、SEO、模板等）见 `docs/` 目录。

## 包含 / 排除清单

**包含**：全部源码（backend/src、frontend/src、tools 各工具的 js/html）、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、tsconfig/vite 配置、`docs/`、`.cmd` 脚本、`.env.example` / `ai.config.example.json` 等模板。

**排除**：`node_modules/`、`dist/`、`*.log`、`*.sqlite` / `*.db`（本地库）、`backend/.env`、`frontend/.env.local`、`managed-sites/*/`（每站 Key、FTP、Google、上传文件和断点）、`tools/*/ai.config.json`、`backups/`、`tools/*/logs/`。

## 常见问题

- **模型显示「未配置」**：在 `backend/.env` 填入对应厂商的 API Key，或在 SEO 工具页「配置 AI API Key」面板直接粘贴保存（保存即生效）。
- **Google Indexing 提交 403**：服务账号不是 Search Console 该资源的所有者，需在 Search Console「设置 → 用户和权限」把服务账号邮箱加为「完整/所有者」。
- **本地库损坏**：强制 kill 后端进程若撞上 sql.js autoSave 会写坏 `backend/dev.sqlite`，用 `backend/dev.before_*.sqlite` 备份恢复。
