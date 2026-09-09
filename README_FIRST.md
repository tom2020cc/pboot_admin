# Pboot Admin 集中多站点版

本项目只部署和启动一套管理系统，通过“站点管理”集中维护本机 phpStudy 或宝塔服务器上的多个 PbootCMS 网站。

## 第一次启动

1. 安装 Node.js LTS。
2. 双击 `00-install.cmd` 安装依赖。
3. 双击 `07-start-all.cmd`。
4. 保持 `Pboot Admin Backend API` 后端终端打开。
5. 浏览器进入管理后台，打开“系统管理 → 站点管理”。
6. 使用“扫描网站”批量识别 `E:\phpstudy_pro\WWW` 下的 PbootCMS 网站，或手工新增站点。

后端首次启动时会自动从 `backend/.env.example` 创建 `backend/.env`，不再需要独立配置向导。

## 多站点规则

- 共用：管理后台、后端接口、模型 API Key、YouTube Data API Key、管理员账号。
- 每站独立：网站根目录、Pboot 数据库、线上网址、YouTube 频道 ID、SEO、FTP、Google、API 参数、任务状态和备份。
- 顶部站点选择器决定当前内容管理、同步、上传和发布操作指向哪个网站。
- 模型 Key 在“模型配置”页面填写一次，所有网站都能使用。

每个网站的配置会自动保存到：

```text
managed-sites/
  站点标识/
    site.json
    api/
    seo/
    ftp/
    google/
    state/
    backups/
```

删除或修改站点标识时，原配置目录会移入 `managed-sites/_archive/`，不会直接清除。

## 日常入口

- `01-sites.cmd`：启动管理服务并直接打开站点管理。
- `02-start.cmd`：只启动管理后台和后端。
- `04-stop-ports.cmd`：停止本项目管理服务。
- `05-start-seo-tool.cmd`：启动 SEO 工具。
- `06-start-ftp-tool.cmd`：启动 FTP 工具。
- `07-start-all.cmd`：日常启动后端、前端、SEO 和 FTP。

## 文档

- [2026-09-09 开发基线与备份说明](docs/PROJECT_BASELINE_20260909_ZH.md)
- [SEO 内容计划与实施范围](docs/SEO_CONTENT_PLAN_ZH.md)
- [新电脑集中版安装教程](docs/NEW_PC_SETUP_ZH.md)
- [宝塔集中部署图文教程](docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md)
- [多站点配置目录说明](managed-sites/README.md)

管理系统本身建议放在 `E:\phpstudy_pro\WWW\pboot_admin_center`，不要再复制到每一个 PbootCMS 网站内部。
