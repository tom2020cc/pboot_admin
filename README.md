# PbootCMS 管理后台 + SEO 收录工具（shanbo.c）

PbootCMS 网站（`shanbo.c`）的辅助管理系统，包含一个 NestJS + Vue3 的管理后台，以及配套的 SEO 收录工具、FTP 发布工具、配置向导等独立工具。用于内容多语言翻译、SEO 优化、sitemap 生成、Google/Yandex 收录提交、视频管理等。

> ⚠️ 本仓库是「干净可移植包」，已排除所有密钥与本地数据（API Key、Google 服务账号私钥、FTP 密码、IndexNow Key、本地 SQLite 库等）。部署后需按下方说明自行配置。

## 技术栈

| 组件 | 技术 |
|---|---|
| 管理后台后端 | NestJS + TypeORM + SQL.js（本地 sqlite，无需 MySQL） |
| 管理后台前端 | Vue 3 + Vite + Element Plus + TypeScript |
| SEO 工具 | 原生 Node.js http 服务 + 原生 HTML/JS（无框架） |
| FTP 工具 | 原生 Node.js http 服务 + 原生 HTML/JS |
| 配置向导 | 原生 Node.js http 服务 + 原生 HTML/JS |

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
│   └── config_wizard/    # 配置向导（写 backend/.env 的 Key、站点地址、油管配置等）
├── docs/                 # 文档
├── *.cmd                 # Windows 一键脚本（安装/配置/启动/停止）
└── README_FIRST.md       # 上手说明
```

## 端口表

| 服务 | 端口 |
|---|---|
| 管理后台后端 | 5008（`backend/.env` 的 `BACKEND_PORT`） |
| 管理后台前端 | 5178 |
| SEO 工具 | 5288（端口被占时自动换 5289+） |
| FTP 工具 | 5189（端口被占时自动换 5190+） |

## 部署步骤

1. **安装依赖**：双击 `00-install.cmd`（或 `pnpm install`）。
2. **配置**：
   - 复制 `backend/.env.example` → `backend/.env`，填写数据库路径、AI Key（DASHSCOPE_API_KEY / ZHIPU_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY）、`YOUTUBE_API_KEY` 等。
   - 复制 `frontend/.env.example` → `frontend/.env.local`（如需）。
   - SEO/FTP 工具的 `seo.config.json` / `ftp.config.json` 用各自页面的配置界面生成（不在仓库里）。
3. **启动**：双击 `07-start-all.cmd`（后端使用可见常驻终端，前端、SEO、FTP 在后台运行），或单独运行 `02-start.cmd` / `05-start-seo-tool.cmd` / `06-start-ftp-tool.cmd`。配置向导只在修改配置时运行。
4. **创建管理员**：双击 `03-create-admin.cmd`。
5. 访问前端 `http://localhost:5178`、SEO 工具 `http://localhost:5288`。

## 脚本速查

| 脚本 | 作用 |
|---|---|
| `00-install.cmd` | 安装前后端依赖 |
| `01-config.cmd` | 打开配置向导 |
| `02-start.cmd` | 启动管理后台（后端可见终端 + 前端后台） |
| `03-create-admin.cmd` | 创建管理员账号 |
| `04-stop-ports.cmd` | 停止所有相关端口 |
| `05-start-seo-tool.cmd` | 启动 SEO 收录工具 |
| `06-start-ftp-tool.cmd` | 启动 FTP 发布工具 |
| `07-start-all.cmd` | 启动日常四项服务，不常驻配置向导 |

## 包含 / 排除清单

**包含**：全部源码（backend/src、frontend/src、tools 各工具的 js/html）、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、tsconfig/vite 配置、`docs/`、`.cmd` 脚本、`.env.example` / `ai.config.example.json` 等模板。

**排除**：`node_modules/`、`dist/`、`*.log`、`*.sqlite` / `*.db`（本地库）、`backend/.env`、`frontend/.env.local`、`tools/*/seo.config.json`、`tools/*/ftp.config.json`、`tools/*/ai.config.json`、`google-submitted.json`、`.runtime.json`、`backend/uploads/`、`backups/`、`tools/*/logs/`。

## 常见问题

- **模型显示「未配置」**：在 `backend/.env` 填入对应厂商的 API Key，或在 SEO 工具页「配置 AI API Key」面板直接粘贴保存（保存即生效）。
- **Google Indexing 提交 403**：服务账号不是 Search Console 该资源的所有者，需在 Search Console「设置 → 用户和权限」把服务账号邮箱加为「完整/所有者」。
- **本地库损坏**：强制 kill 后端进程若撞上 sql.js autoSave 会写坏 `backend/dev.sqlite`，用 `backend/dev.before_*.sqlite` 备份恢复。
