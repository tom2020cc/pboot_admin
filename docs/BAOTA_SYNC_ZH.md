> 2026-09-22 发布流程更新：页面分为「代码同步」「项目配置同步」「站点配置同步」。连接设置只需配置一次。
>
> 代码同步开启自动上线后，使用已有宝塔账号创建临时构建任务，执行 `deploy/apply-project.sh`，持续读取日志，只有前后端构建、PM2 重启及 baota 环境健康检查通过才显示「已上线」。失败会明确报错；没有新增源码也可重试构建。临时任务结束后清理。
>
> 未配置自动上线时显示「代码已上传，等待上线」，在宝塔终端执行 `bash /www/wwwroot/pboot_admin_center/deploy/apply-project.sh` 即可。不是上传完成就代表上线。部署不复制 .env、数据库、managed-sites 配置或上传目录。
>
> 项目配置只处理明确勾选的公共模型密钥、管理后台图片；站点配置只处理勾选站点的 SEO / FTP / Google / 图片。两个入口相互独立，默认不勾选配置项。站点档案及任务状态不再放在简化界面中。系统授权码继续使用专门的按环境同步入口。
>
> 本次问题根因：线上 9 月 22 日已收到区域管理源码，但实际使用的前后端构建仍是 9 月 21 日版本。原远程构建忽略命令失败、固定等待后即报成功；现改为失败即停止并验证完成标记。

# 宝塔同步（FTP 工具「宝塔同步」页）

更新日期：2026-09-20。功能入口：FTP 工具 → 「宝塔同步」标签页（`sync.html`）。

工具分两个互不干扰的同步页面：

- **网站同步**（`/`，原「FTP 发布」）：把当前站点**发布到线上**（data/*.db、static、uploads 或整站）；目标存在每站 `ftp.config.json`，同步宝塔站点时点「一键填入宝塔目标」直接复用宝塔账号。
- **宝塔同步**（本页，`/sync.html`）：**管理项目本身**（代码 / 配置 / 数据库暂存）→ 宝塔项目目录；目标存在 `sync.config.json`。

**两个页面均仅本地环境开放**：`backend/.env` 中 `APP_ENVIRONMENT=local` 时可见；宝塔线上环境自动隐藏入口（首页跳转安全巡检），接口返回 403。遵循 [LOCAL_BAOTA_WORKFLOW_ZH.md](LOCAL_BAOTA_WORKFLOW_ZH.md) 的原则：每次同步都是显式手动操作，不自动双向同步，两环境的数据库、密钥与运行配置保持独立。

## 一、准备：在宝塔开通 FTP 账号

同步走 FTP/FTPS 通道，需要宝塔服务器上开通 FTP 服务与账号（宝塔 → 软件商店 → 纯FTPD）：

| 目标 | FTP 账号根目录 | 用途 |
| --- | --- | --- |
| 管理项目 | `/www/wwwroot/pboot_admin_center` | 同步 ①代码、②配置、③数据库暂存 |
| 每个 PB 网站（如 shanbo-rig.com） | `/www/wwwroot/<域名>` | 同步 ④网站数据 |

建议在纯FTPD 设置中启用 TLS，并在同步目标里选择「FTPS 加密」——②配置同步包含 FTP 密码、Google 凭据、模型密钥，明文 FTP 有被监听风险。

## 二、配置同步目标

打开「宝塔同步」页第一张卡：

1. 「目标」下拉选择管理项目或某个站点。
2. 填 FTP 地址、端口、用户名、密码；远程根目录填该账号登录后的网站根（登录即根目录时填 `/`）。
3. 「服务器绝对路径」填该目标在服务器上的真实路径（如 `/www/wwwroot/pboot_admin_center`、`/www/wwwroot/shanbo-rig.com`）——它**不参与 FTP 路径**，只用于 JSON 配置里的路径改写和核对清单提示。
4. 保存后点「测试连接」：项目目标应识别出 `package.json`/`backend`/`frontend`，站点目标应识别出 `data` + `static/template/apps`（PbootCMS 根目录特征）。

目标配置保存在 `tools/ftp_publish_tool/sync.config.json`（含明文密码，已 git-ignore，勿提交勿外传）。

## 三、三个同步预设

### ① 项目功能（代码）

- 内容：`backend/src`、`frontend/src`、`tools`、`deploy`、`docs`、`package.json`、锁文件等「可发布文件」。
- 过滤规则与 `tmp/prepare-baota-release.py` 发布审计一致：`.env*`（除 `.env.example`）、`ai.config.json`、`ftp.config.json`、`sync.config.json`、`security-*.json`、`google-*.json`、`*.sqlite/*.db`、`managed-sites/**`（除 README）、`node_modules`、`dist`、`logs`、`tmp`、`uploads`、`data`、`frontend/public/tutorial` 大图等一律不上传。
- 增量方式：本地 sha256 清单（`sync-state/project/project-code.manifest.json`），只上传新增与内容变化文件；「本地已删」仅报告，不删除远端。可选「全量重传」「覆盖前备份远端」。
- **上传后需在宝塔端手动执行**（页面提供可复制清单）：

  ```bash
  cd /www/wwwroot/pboot_admin_center
  pnpm --dir backend install --frozen-lockfile && pnpm --dir backend run build
  pnpm --dir frontend install --frozen-lockfile && pnpm --dir frontend run build
  pm2 restart pboot-admin-api
  ```

### ② 项目数据与配置

- 按站点勾选节：`site.json`、`seo/`、`ftp/`、`google/`、`state/`、`api/uploads/`；另有 `backend/uploads` 与「模型密钥 ai.config.json（仅密钥字段）」开关。
- **路径改写**：JSON 配置里的本地路径（站点根 `E:/phpstudy_pro/WWW/<站点>`、项目根）自动替换为服务器路径（按目标配置的「服务器绝对路径」），密码与密钥原样保留；页面会展示映射表供核对。
- 巡检基线/断点（`security-*.json`、`security-evidence/`）属于本机状态，不同步。
- 注意：服务器后端每次启动会用数据库重新生成 `site.json`，上传的 `site.json` 仅作参考；站点路径要在服务器「站点管理」里改。
- 未启用 FTPS 且勾选了密钥类内容时，页面会给出明文传输警告。

### ③ 管理数据库（仅暂存上传）

- 把本地 `dev.sqlite` 上传到服务器 `data/sync-staging/pboot-admin-<时间戳>.sqlite`，并附同名 `.json` 校验单（sha256、大小、导出时间）。**绝不覆盖线上 `data/pboot-admin.sqlite`**。
- 建议先停止本地后端（`stop.cmd`）再上传，避免复制到写入中的库文件。
- 接管（可选、手动）：停 PM2 → 备份线上库 → 用暂存文件替换 → 修正 `managed_sites` 表的环境行（`environment='baota'`、`rootPath`、`dbPath`、`publicBaseUrl`）→ 启动 → `GET /project-identity` 验收。页面完成清单含完整步骤与 sqlite3 命令示例。

### ④ PB 网站数据 → 已迁至「网站同步」页

PB 网站数据（数据库 + 图片 / 整站镜像）的发布在 **网站同步** 页（工具首页）操作：

1. 打开 FTP 工具首页（`http://localhost:5389/`），顶栏切换到目标站点。
2. 点「一键填入宝塔目标」——自动把「宝塔同步」配置里该站点的 FTP 账号（含密码）写入本页配置。
3. 选择上传范围（数据+图片 / 仅 SEO 文件 / 整站），「开始同步」。同大小图片自动跳过，远端同名文件先下载备份。

## 四、安全与互斥

- 同步与 FTP 发布、安全巡检、宝塔服务器巡检互斥：任一任务运行中，其他任务按钮停用，接口返回 409。
- 覆盖前备份（若启用）下载到 `tools/ftp_publish_tool/backups/ftp-overwrite/<时间>/`；同步清单与暂存在 `tools/ftp_publish_tool/sync-state/`。两者均已 git-ignore。
- 「本地已删」文件只在计划中报告，本功能**从不删除远端文件**。
- 增量清单只记录本地视角；如果远端被第三方改动，同步会直接覆盖（可先在服务器跑一次 FTP 安全巡检确认远端干净）。

## 五、常见问题

- **导航里没有「宝塔同步」**：检查 `backend/.env` 的 `APP_ENVIRONMENT=local`，重启 FTP 工具。
- **测试连接 530/登录失败**：核对宝塔纯FTPD 中该账号状态与密码；账号根目录是否就是要同步的目录。
- **FTPS 连接失败**：宝塔纯FTPD 默认可能未启用 TLS；在软件商店 → 纯FTPD → 设置中开启，或确认无法启用后再改用「普通 FTP」（密钥类内容慎选）。
- **同步后服务器报模块缺失**：代码同步不会安装依赖，务必执行核对清单里的 `pnpm install --frozen-lockfile` 与构建命令。
