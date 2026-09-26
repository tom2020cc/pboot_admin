# 管理后台后端（NestJS）

PbootCMS 集中多站点管理系统的 API 服务。项目总览与启动脚本见[根目录 README](../README.md)。

## 技术栈

- NestJS 10 + TypeORM 0.3
- 默认 SQL.js 本地 SQLite（`DB_TYPE=sqljs`，无需外部数据库），可选 PostgreSQL（`DB_TYPE=postgres`）
- JWT 登录态（全局守卫，`@Public()` 放行公开接口）+ bcryptjs
- sharp 生成缩略图；Playwright Chromium 生成报价单 / 产品手册 PDF
- Swagger 接口文档：`/api-docs`（需 `ENABLE_SWAGGER=true`）

## 环境要求

- Node.js ≥ 22.12，pnpm 9

## 快速开始

```bash
pnpm install
pnpm start:dev     # 默认端口 5108（.env 的 BACKEND_PORT）
```

首次启动会自动从 `.env.example` 生成 `.env`；各环境变量含义见模板内注释。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm start:dev` | 开发模式（watch） |
| `pnpm build` | 构建到 `dist/` |
| `pnpm start:prod` | 运行构建产物 |
| `pnpm test` / `pnpm test:cov` | Jest 单元测试 / 覆盖率 |
| `pnpm lint` | ESLint 检查并修复 |

## 结构速览

| 目录 | 说明 |
| --- | --- |
| `src/sites/` | 站点注册、目录扫描发现、运行环境默认值 |
| `src/auth/`、`src/user/` | JWT 认证与管理员账号 |
| `src/menu/`、`src/news/`、`src/product/`、`src/page/`、`src/video/` | 内容与多语言翻译、同步到 PbootCMS |
| `src/quotation/`、`src/brochure/` | 报价单与产品手册 PDF 生成 |
| `src/img-upload/`、`src/site-information/`、`src/seo-content/`、`src/database-backup/` | 图片上传、站点资料、SEO 内容、数据库备份 |
| `src/common/` | PbootCMS 内容导入、翻译与缩略图等共享工具 |

单元测试（`*.spec.ts`）与源码同目录。受管站点通过请求头 `X-Pboot-Site-Id` 区分，每站配置保存在根目录 `managed-sites/`。

## 生产注意

`NODE_ENV=production` 时 `/auth/signup` 被拒绝（不开放公开注册）。生产环境首管理员由根目录 `deploy/bootstrap-admin.cjs` 创建，详见[宝塔集中部署图文教程](../docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md)。
