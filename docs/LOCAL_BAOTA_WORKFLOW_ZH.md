# 本地与宝塔配置

更新：2026-09-17

先本地修改和验证，再单独发布代码。两个环境的数据库、密钥与运行配置独立保存，不自动双向同步。

本地列依据当前运行配置；宝塔列依据 2026-09-17 下载的管理项目备份和现有部署文件，不代表正在实时读取服务器。

## 配置对照

### 用途与标识

- 本地：本地调试，绿色环境条；APP_ENVIRONMENT=local。
- 宝塔：宝塔线上，红色环境条；APP_ENVIRONMENT=baota。新增标识要等本次代码正式部署后才会出现。

环境条读取实际管理后端的标识，不靠网址或构建模式猜测；旧接口、配置缺失或连接失败显示“环境未确认”。它是提示，不是隔离或权限控制。

### 管理项目目录

- 本地：E:/phpstudy_pro/WWW/pboot_admin_center
- 宝塔：/www/wwwroot/pboot_admin_center

只更新此管理项目。不要把本地 E: 路径复制到 Linux，也不要把服务器的 /www 路径原样用于 Windows。

### 管理后台入口

- 本地：http://localhost:5278
- 宝塔：https://admin.shanbo-rig.com

本地由 Vite 提供页面。线上由 Nginx 提供 frontend/dist 和 HTTPS，不需要对外开放 Vite 的 5278 端口。

### 管理 API

- 本地：VITE_API_BASE_URL=http://localhost:5108
- 宝塔：VITE_API_BASE_URL=/api；Nginx 将 /api/ 转发到 127.0.0.1:5108。

线上如果带入 localhost:5108，访问者会请求他自己的电脑。开发构建不能直接当作生产发布包使用。

### 管理数据库

- 本地：backend/dev.sqlite；DB_TYPE=sqljs，DB_SQLJS_LOCATION=dev.sqlite。
- 宝塔：data/pboot-admin.sqlite；DB_SQLJS_LOCATION=/www/wwwroot/pboot_admin_center/data/pboot-admin.sqlite。

保存管理账号、栏目、产品、多语言内容、报价单、产品 PDF 资料等。刚完成的一次覆盖不是持续同步，以后两边的新增与修改各自独立。

### PB 网站目录与库

- 本地：E:/phpstudy_pro/WWW/shanbo-rig.c；数据库 data/1412def6361bfd54fd4f519f81ba2d22.db。
- 宝塔：/www/wwwroot/shanbo-rig.com；数据库 data/1412def6361bfd54fd4f519f81ba2d22.db。

PB 网站与管理项目是两个目录、两套数据库。此次工作不覆盖 PB。后台的“同步 PB / 覆盖 PB”会另行写入当前站点绑定的 PB 数据库。

### 站点绑定

- 本地：管理库 managed_sites 的 environment=phpstudy，rootPath/dbPath 指向 E:/.../shanbo-rig.c，publicBaseUrl=http://shanbo-rig.c。
- 宝塔：managed_sites 的 environment=baota，rootPath/dbPath 指向 /www/wwwroot/shanbo-rig.com，publicBaseUrl=https://shanbo-rig.com。

后台→站点管理查看和维护。managed-sites/<站点编码>/site.json 是对应配置文件，启动时会按管理数据库重新生成。只改 site.json 而不改管理数据库不能保证生效。APP_ENVIRONMENT 与站点 environment 是两个概念。

### 环境文件

- 本地：backend/.env；frontend/.env.local。当前前后端端口分别为 5278 / 5108。
- 宝塔：backend/.env；frontend/.env.production.local；deploy/baota.ecosystem.config.js。

后端读取自己的工作目录中的 .env，进程已有变量可能优先。前端变量在编译时写入 JS，改完必须重建。VITE_ 开头的变量会进入浏览器，不能存密钥。

### SEO / 模型 / FTP

- 本地：http://localhost:5388；http://localhost:5389。仅监听本机。
- 宝塔：https://seo-admin.shanbo-rig.com；https://ftp-admin.shanbo-rig.com，由 Nginx 代理本机 5388 / 5389。

本地工具不等于离线：FTP 仍可能连接真实服务器；搜索引擎推送会调用外部服务；模型与 YouTube 请求使用真实额度。环境标识不会阻止这些操作。

### 密钥与业务设置

- 本地：共享模型 / YouTube Key 在 backend/.env 或 tools/seo_publish_tool/ai.config.json；当前站点频道 ID 在 managed_sites。
- 宝塔：保留服务器自己的 .env、模型配置和 managed-sites 下的 SEO / FTP / Google 配置。

不要上传真实 Key、JWT_SECRET、SEO_WORKER_TOKEN、Google 服务账号 JSON、FTP 密码。运行数据不放公开 GitHub。这里只显示配置位置，不展示密钥值。

### 运行方式与依赖

- 本地：Windows；前端 Vite，后端 Node；tools/run-backend.cmd 可本地启动后端。
- 宝塔：Linux；宝塔管理的 PM2 运行 Node，Nginx 对外提供 HTTPS。

项目声明 Node >=22.12.0。node_modules 不能从 Windows 上传到 Linux，尤其 sharp 与浏览器等平台相关组件。应在服务器按锁文件安装。不要另起一套 PM2 或同时启动两份后端。

### PDF 与文件权限

- 本地：本机安装的 Playwright Chromium，或本机有效的 PDF 浏览器路径。
- 宝塔：服务器已有的 BROCHURE_PDF_EXECUTABLE_PATH / QUOTATION_PDF_EXECUTABLE_PATH、Chromium 及 Linux 依赖。

不要用 Windows 浏览器路径覆盖线上值。运行用户必须可写管理数据库、上传目录；需要同步 PB 时，PHP / 管理服务对 PB 数据库和目录的权限也要匹配，不要整站 chmod 777。

## 上传到宝塔会不会报错？

不是把本地整个文件夹拖上去就一定能运行，也不能承诺永远不报错。源码可以共用，但操作系统、接口地址、数据库位置、进程环境、依赖与权限必须匹配。

本地开发版本构建成功，只说明本机编译通过。正式发布还要在服务器检查配置、安装平台依赖、编译、重启并验收。数据库实体变更尤其需要单独评估：当前 TypeORM 配置启用了 synchronize，启动新版后端可能调整表结构。


## 哪些可以更新，哪些不能覆盖

常规功能更新只发布审核过的源码、依赖清单和锁文件，以及必要的静态资源。backend/src、frontend/src、frontend/public、tools 中的代码和 deploy 中确有需要的脚本，可按本次变更清单更新。

必须保留服务器 backend/.env、frontend/.env.production.local、管理数据库 data/pboot-admin.sqlite、managed-sites、uploads、真实模型配置、Google 凭据、FTP 配置、日志和备份。GitHub 不接收这些运行数据。

不要上传本地 node_modules、backend/dev.sqlite、frontend/.env.local，也不要直接发布按本地接口编译出的 frontend/dist。不要用整个项目目录的镜像删除模式清理线上文件。PB 的 shanbo-rig.com 目录不在管理项目发布范围内。


## 默认工作顺序

以后先在本地完成调整并给出测试结果，再作为单独一步发布到宝塔。这份教程及环境标识此次只在本地生效，没有修改宝塔。

不自动备份或上传 GitHub。只有你明确要求当前这次操作时才执行。一般代码发布也不自动同步业务数据；数据迁移需明确来源、目标与覆盖范围。

1. 本地修改：记录涉及哪些模块和文件，不改线上站点。
2. 本地验证：编译前后端，跑相关测试，实际检查页面和关键流程。测试外部发布、推送、付费模型调用前单独确认目标。
3. 发布前核对：确认代码版本、变更清单、是否涉及数据结构、现有可恢复版本，以及本次是否需要你授权新的备份。
4. 确认发布后：保留线上环境文件和数据，只上传本次代码改动；在宝塔环境安装依赖、构建和检查。
5. 线上验收：确认环境标识为“宝塔线上”，检查登录、产品、多语言、报价单/PDF 和工具入口。不要用真实删除、FTP 发布或搜索推送作为普通冒烟测试。

## 本地检查命令

在管理项目根目录执行。预检只读配置和文件，不修改环境、数据库或 PB 网站；输出只包含检查名称与建议，不显示密钥值。

预检通过不代表全部功能通过，也不替代页面、导出、网络和权限验收。依赖、证书、Linux 系统库与反向代理仍要在目标服务器上确认。


### PowerShell · 本地项目

```text
cd E:\phpstudy_pro\WWW\pboot_admin_center
node deploy/check-environment.cjs --target local
pnpm --dir backend run build
pnpm --dir frontend run build
```


## 已有宝塔项目的代码更新

这是已有项目升级，不要重新执行 prepare-baota.sh 初始化，不要导入本地数据库，不要重建管理员。上传前先看本次变更清单，保留服务器的配置和运行数据。

后台标识通过 APP_ENVIRONMENT=baota 设置；本次修改后的宝塔 ecosystem 配置也显式传入此值。若现有 PM2 配置有自定义项，按差异合并，不整文件替换。

依赖和编译应在宝塔现有 Node / PM2 使用的同一运行环境执行。下面命令不会上传代码，必须先完成经过确认的代码更新。最后通过宝塔现有 PM2 管理器重启受影响的进程；若进程环境变了，必须更新该 PM2 实例的环境，不能只刷新网页。

> 代码上传这一步可以在本地 FTP 工具的「宝塔同步」页一键完成（项目代码 / 配置 / 数据库暂存 / 网站数据四个预设，均为显式手动操作），见 [BAOTA_SYNC_ZH.md](BAOTA_SYNC_ZH.md)。数据库与密钥仍按本文件原则独立保存，不做自动同步。

1. 在宝塔保留 backend/.env，并确认 APP_ENVIRONMENT=baota、NODE_ENV=production、DB_SQLJS_LOCATION=/www/wwwroot/pboot_admin_center/data/pboot-admin.sqlite。
2. 保留 frontend/.env.production.local，确认 API=/api，SEO / FTP 为各自 HTTPS 管理域名。服务器不要带入本地 .env.local。
3. 根据锁文件在服务器安装依赖，然后预检和编译。若预检报错，先修复配置，不盲目重启服务。
4. 通过宝塔当前 PM2 管理器重启 pboot-admin-api；tools 代码变化时重启对应 pboot-seo-tool / pboot-ftp-tool。只有 worker 代码变化且确有需要时才处理 worker，不能因此新开自动发布。
5. 打开三个线上管理入口并验收。现有 Nginx 的 /api/ 代理、HTTPS、静态目录和数据库权限保持正确。

### 宝塔终端 · 在现有 Node 环境运行

```text
cd /www/wwwroot/pboot_admin_center
pnpm --dir backend install --frozen-lockfile --prod=false
pnpm --dir frontend install --frozen-lockfile --prod=false
pnpm --dir tools/seo_publish_tool install --frozen-lockfile --prod=false
pnpm --dir tools/ftp_publish_tool install --frozen-lockfile --prod=false
node deploy/check-environment.cjs --target baota
pnpm --dir backend run build
pnpm --dir frontend run build
```


## 常见问题与定位

页面能开但登录失败、请求发往 localhost：检查线上前端编译时的 VITE_API_BASE_URL，应该是 /api。修正生产环境文件后重建，不能仅修改已经上传的 .env。

产品/报价单突然为空或账号变了：先检查 DB_SQLJS_LOCATION、后端工作目录、实际加载的管理数据库；不要为了让页面有数据就覆盖线上库。

本地页面显示“宝塔线上”：说明配置连接了线上后端。先检查当前页面和接口地址，不要把它当成本地隔离测试。显示“环境未确认”时，检查 APP_ENVIRONMENT 和 /project-identity 接口；旧后端需要随本次代码升级。

同步 PB 报目录/权限错误：检查当前 managed_sites 的 rootPath、dbPath 及运行用户。管理库可写不等于 PB 库可写，文件可写也不等于目录可创建 SQLite 日志文件。

PDF 引擎找不到或启动失败：检查实际服务用户下的 Chromium 路径和系统依赖。保留服务器已有 PDF 引擎配置，必要时按所用 Linux 发行版安装 Playwright 官方支持的浏览器和依赖。

更新后仍是旧功能：确认服务器编译成功、Nginx 指向正确的 frontend/dist、正确的 PM2 进程已经重启，再排查浏览器缓存。

SEO / FTP 跳到错误地址：检查后端 ADMIN_PUBLIC_URL / SEO_PUBLIC_URL / FTP_PUBLIC_URL，以及前端 VITE_SEO_TOOL_URL / VITE_FTP_TOOL_URL；前端改配置后需要重新构建。


## 多语言域名上线检查

资料同步的数据库回读成功，只表示站点与公司字段已经写入，不代表域名能够访问。每个语言都须依次检查：DNS 解析 → 宝塔站点绑定 → HTTPS 证书覆盖 → PB 官方域名授权 → 区域与模板配置 → 实际首页响应。不要只验收 CN 首页。

2026-09-22 排查 shanbo-rig.com 的结果：

- `vi`、`tr`、`id` 的公共 DNS 查询返回 NXDOMAIN；应在该域名现有 DNS 管理后台添加对应 A 记录，目标为 `43.160.236.132`。添加后先确认解析生效，再申请证书。
- `pt` 已有 A 记录；但当前证书仅包含主域名及 `cn/es/ar/fr/ru`，缺少 `pt/id/vi/tr`。宝塔添加站点域名不会自动扩展已有证书，须重新申请包含所有业务域名的证书并验证续期配置。
- `ar` 的 DNS、证书和静态文件正常，PHP 实际提示域名没有有效官方授权码；Nginx 错误页将它显示为普通 404。本地保存的线上授权码与在线库的 SHA-256 一致，重复同步不能修复错误授权码。需要从官方获取此域名的正确授权码，再通过系统授权码功能写入线上。
- 10 个语言的 PB 区域域名和站点模板选择均已存在；上述问题不需要覆盖数据库或重建模板。

验收时保持 HTTPS 证书校验开启，逐一确认域名解析、首页 HTTP 200、正确语言内容及产品页可访问。看到 Nginx 404 时，先区分静态资源与 PHP 请求；不要直接清库、放开受保护目录或关闭证书校验。

本次仅完成诊断和本地同步提示说明，没有修改 DNS、重新签发证书或替换官方授权码。DNS 管理登录和有效 AR 授权码尚待提供。

## 官方参考

- [Vite：环境文件、优先级与构建模式](https://vite.dev/guide/env-and-mode)
- [Playwright：浏览器与系统依赖](https://playwright.dev/docs/browsers)
- [PM2：进程重启与更新环境变量](https://pm2.keymetrics.io/docs/usage/process-management/)
