# 宝塔部署截图与步骤记录

## 2026-09-12 续：中文域名与 Nginx 修复

本次重新接通内置浏览器控制及截图接口。通过宝塔 UI 确认语言域名已绑定、网站根目录及 PHP 正确，但伪静态为空。先备份 `/www/backup/shanbo-rig-nginx-before-20260912.tgz`，再在本站“伪静态”中保存官方规则。`nginx -t` 成功，CN 仍报域名授权错误。站点负责人随后亲自补充官方授权，中文首页恢复。

最终 HTTPS 验证：主站首页、CN 首页、无问号的中文产品栏目、CR1000I 详情、中文新闻详情、admin 首页均为 200；`/data/` 维持 404。内置浏览器实际检查了中文首页、栏目与详情。原有兼容 URL 生成模式保留；其他语言尚未逐一验收，不计为全部修复。没有修改业务文章、产品、数据库或授权校验代码；没有推送 GitHub。

新增教程章 `nginx-language` 包含八步配置与复用清单，11 张新增实操截图及 1 张 SVG；教程总计 17 章、58 步、34 张实操截图、10 张 SVG。

### 本次教程发布与验收

- 通过内置浏览器的宝塔文件上传窗口上传 `pboot-tutorial-cn-nginx-20260912.tgz`，服务器 SHA-256 校验通过：`90ed08dcd9c143204f1409dbe127b102bfbd3f703be36cbbc7f836eaed959412`。
- 内容更新模式先检查源文件基线及上传文件哈希，再备份并构建；不覆盖业务数据库，不重启 SEO / FTP 服务。
- 发布日志：`/www/backup/pboot-tutorial-cn-nginx-20260912.log`，结果 `TUTORIAL_RELEASE_COMPLETE`。
- 发布前备份：`/www/backup/pboot-tutorial-before-20260912-103305.tgz`。
- 上一版静态目录：`/www/wwwroot/pboot_admin_center/frontend/dist-before-tutorial-20260912-103330`。
- 本地 15 项针对性测试、前端类型检查和生产构建通过，服务器发布构建通过。
- 正式 HTTPS 入口的 44 个教程素材逐一与本地清单进行 SHA-256 比对，44/44 通过。内置浏览器确认新增章节、实操图、图片查看器和箭头标注正常。
- 已打开的后台单页仍可能保留旧 JavaScript；刷新完整页面后显示 17 章 / 58 步，而非旧版 16 章 / 50 步。
- 入口：`https://admin.shanbo-rig.com/#/deployment-tutorial?chapter=nginx-language`。新增发布验收截图只作本地运维记录，不再次加入本次公开素材包。

| 文件 | 内容 |
| --- | --- |
| 83-browser-screenshot-restored.jpg | 内置浏览器截图恢复测试，未列入公开素材 |
| 84-pboot-language-domain-bindings.jpg | 同一 PHP 站点语言域名绑定 |
| 85-pboot-document-root.jpg | 实际根目录、运行目录与原有保护 |
| 86-pboot-rewrite-empty.jpg | 修复前空伪静态编辑器 |
| 87-nginx-backup.jpg | 本站配置备份成功 |
| 88-pboot-rewrite-saved.jpg | 已保存官方根目录规则 |
| 89-nginx-test-after-rewrite.jpg | Nginx 检查成功，授权补充前中文仍 404 |
| 90-cn-application-error.jpg | PHP-CGI 返回的中文域名授权错误，不含授权码 |
| 91-cn-home-restored.jpg | 负责人补充授权后中文首页恢复 |
| 92-cn-clean-product-list.jpg | 无问号中文产品栏目 |
| 93-cn-clean-product-detail.jpg | 无问号 CR1000I 详情 |
| 94-cn-nginx-verification.jpg | 最终 HTTP 与目录保护验证 |
| 95-tutorial-cn-uploaded.jpg | 宝塔教程更新包上传成功 |
| 96-tutorial-release-complete.jpg | 服务器构建完成及回退位置 |
| 97-live-nginx-tutorial.jpg | 正式 Vue 后台新增教程章节 |
| 98-live-nginx-rule-annotation.jpg | 正式页面截图查看器及伪静态箭头标注 |

素材保留原始字节，箭头由教程的 SVG 覆盖层显示，可以单独开关。后续正文保留首次部署历史，过时的“等待授权”记录以本节及在线教程的最新验收结果为准。

日期：2026-09-11。项目：pboot_admin_center。

本目录保存本次实际操作截图，供以后制作教程。PNG 原图只保存在本地，已加入 Git 忽略规则；发布教程前另行确认是否展示面板地址、服务器 IP 和账户邮箱。没有保存登录密码、API Key 或证书私钥画面。

## 已完成

1. 宝塔安装 Node 22.23.2、pnpm 9.15.9，使用已有 PM2 管理器维护四个项目进程。
2. 项目全新安装于 `/www/wwwroot/pboot_admin_center`，安装阶段未导入本地业务数据。后续按用户要求接入线上 `shanbo-rig.com`，见下方“接入线上业务站”记录；未操作其他网站。
3. 网站 > 反向代理 > 添加反代，绑定 `admin.shanbo-rig.com`，目标 `http://127.0.0.1:5278`，发送域名保持 `$http_host`。
4. 项目设置 > SSL > 免费证书，选择 Let's Encrypt、文件验证，勾选本项目域名后申请。
5. 在免费证书列表中选择匹配 `admin.shanbo-rig.com` 的证书部署。不要把其他网站的证书部署到该入口。
6. 验证 HTTP 自动跳转 HTTPS、HTTPS 证书匹配域名、`/api/project-identity` 返回正确项目标识。
7. 在宝塔终端暂停本项目 API 和 SEO worker，运行 `node deploy/bootstrap-admin.cjs admin@pboot.local`，随后恢复进程并 `pm2 save`。该命令仅用于没有用户的首次安装，拒绝覆盖已有账户。
8. 通过正式域名登录，验证概览和站点管理。修复无站点时账户信息不显示的问题，保持 SEO 全局暂停。
9. 确认 `seo-admin`、`ftp-admin` 两条 A 记录指向本服务器，分别建立宝塔反向代理项目。先以受保护的主后台为临时目标，配置 http 认证后，再把目标改为内部 SEO/FTP 端口。
10. 工具项目设置 > 全局配置 > http认证，认证路径为 `/`，用户名为 `admin`。本版宝塔认证密码限制为 3 到 8 位；不要把主后台长密码直接填入此表单。
11. 分别为两个工具域名申请 Let's Encrypt 文件验证证书，确认认证域名匹配，开启强制 HTTPS。两个证书到期时间均为 2026-12-10。
12. 从外部验证两个工具域名：HTTP 返回 301 跳转 HTTPS；HTTPS 证书校验通过，未认证请求返回 401。没有开放 5388/5389 公网端口。
13. 在宝塔终端应用公共域名导航、空站点保护补丁，运行环境配置脚本，构建前端，重启 SEO/FTP 并保存 PM2 列表。服务器上的 6 项针对性测试通过。
14. 运行 `deploy/verify-production.cjs`，三个域名 HTTPS 跳转、管理员登录、站点列表、SEO/FTP 认证后页面与配置、跨工具导航、模型状态接口均通过。密码只从服务器 root 私有文件读取，没有打印到终端。
15. 运行 SEO worker 的 `--check`，确认接口认证正常、协议为 2、全局开关暂停、模型密钥未配置。没有领取任务或发布文章。
16. 在宝塔 PM2 管理器确认四个项目运行。额外发现 `pm2-root` 仅 enabled、尚未 active；核对启动路径后执行 `pm2 save` 和 `systemctl start pm2-root`，现已 active + enabled，进程 PID 保持不变。没有重启服务器。
17. 修复产品介绍在空站点时显示“0”、请求不存在站点资料的问题。服务器重新构建后，页面显示“尚未添加网站”和添加入口，禁用依赖站点的操作。编辑禁用与后台任务忙碌状态分开判断，空站点仍能返回后台、进入站点管理，不会被离开页面保护拦截。

## 截图索引

| 文件 | 内容 | 教程用途 |
| --- | --- | --- |
| 01-domain-reverse-proxy.png | 域名、代理目标、发送域名填写 | 添加反代表单 |
| 02-domain-project-created.png | 主后台反代创建成功 | 确认项目存在 |
| 03-ssl-application.png | Let's Encrypt 文件验证申请 | 证书申请表单 |
| 04-ssl-issued.png | 新域名证书订单完成 | 选择正确证书部署 |
| 05-domain-https-ready.png | 主后台项目显示证书有效期 | HTTPS 已部署 |
| 06-admin-initialization.png | 管理员创建及四个进程恢复 | 初始化结果，不含密码 |
| 07-login-and-worker-verification.png | HTTPS 登录成功、站点列表为空、SEO 请求返回 400 | 排错记录：未添加站点时不能读取该站 SEO 计划，不作为全部验收成功图 |
| 08-https-login-page.png | 正式 HTTPS 登录页 | 首次访问 |
| 09-admin-dashboard.png | 修复前概览页账户信息为空 | 排错对照图 |
| 10-fresh-install-update-check.png | 前端构建完成、worker 鉴权通过且全局暂停 | 实际运行检查，未调用模型或发布文章 |
| 11-fresh-dashboard-verified.png | 修复后管理员数量和邮箱正确、无站点提示 | 优先使用的登录成功图 |
| 12-empty-sites.png | 站点管理列表为空 | 全新安装未迁移数据 |
| 13-seo-http-auth-form.png | SEO 认证的初次填写，无密码 | 排错草稿：最终用户名改为 admin，正式示例参照第 22 张 |
| 14-seo-http-auth-saved.png | SEO 的 PbootTools 认证规则已保存 | 确认保护整个 `/` 路径 |
| 15-seo-proxy-target.png | SEO 实际代理目标 127.0.0.1:5388 | URL 代理设置 |
| 16-seo-proxy-created.png | SEO 项目和代理目标 | 证书申请前状态 |
| 17-seo-ssl-application.png | SEO 域名的 Let's Encrypt 申请表 | 文件验证申请 |
| 18-seo-ssl-issued.png | SEO 免费证书订单完成 | 签发结果，不包含私钥 |
| 19-seo-https-ready.png | SEO 项目显示证书有效期 | SEO HTTPS 配置完成 |
| 20-ftp-proxy-form.png | FTP 项目临时指向受保护的主后台 | 开放实际工具前先配置认证 |
| 21-ftp-proxy-created.png | FTP 反代建立成功 | 确认项目存在 |
| 22-ftp-http-auth-form.png | FTP 认证用户名和路径，无密码 | 正式认证表单示例 |
| 23-ftp-http-auth-saved.png | FTP 的 PbootTools 认证规则 | 认证保存成功 |
| 24-ftp-proxy-target.png | FTP 实际目标 127.0.0.1:5389 | URL 代理设置 |
| 25-ftp-proxy-ready.png | FTP 项目与内部目标 | 证书申请前状态 |
| 26-ftp-ssl-application.png | FTP 域名的 Let's Encrypt 申请表 | 文件验证申请 |
| 27-ftp-ssl-issued.png | FTP 免费证书订单完成 | 签发结果，不包含私钥 |
| 28-three-https-projects.png | 三个管理域名均显示证书有效期 | 宝塔域名部署总览 |
| 29-deployment-tests-and-processes.png | 首次补丁应用、测试与工具重启成功 | 部署过程记录，顶部有补丁编码，教程优先选第 30/31 张 |
| 30-nginx-and-stable-processes.png | 四个进程在线、Nginx 检查成功 | 运行状态检查 |
| 31-https-login-navigation-worker-verified.png | HTTPS、登录、导航和 worker 只读检查均通过 | 正式域名接口验收 |
| 32-production-dashboard-and-navigation.png | 正式后台与生产域名导航 | 首次登录后的总览 |
| 33-baota-pm2-four-projects.png | 宝塔 PM2 管理器显示四个项目 | 日常进程维护入口 |
| 34-brochure-empty-site-before.png | 产品介绍空站点修复前 | 排错对照图 |
| 35-build-and-startup-check.png | 构建成功，但自启服务 inactive | 说明 enabled 不等于 active |
| 36-brochure-empty-site-fixed.png | 产品介绍空站点提示与禁用状态 | 修复后的正式页面 |
| 37-pm2-system-service-ready.png | PM2 系统服务 active + enabled、四个进程在线 | 自启配置验收 |
| 38-final-production-verification.png | 最终 HTTPS、登录、导航、模型状态和 worker 检查通过 | 最终验收；明确未提交或上传 GitHub |
| 39-navigation-guard-build.png | 产品介绍离开页面保护修复构建成功 | 空站点导航回归修复 |
| 40-return-to-dashboard-verified.png | 从空站点产品介绍成功返回管理后台 | 实际导航验收 |
| 41-shanbo-rig-root-404.png | 业务站最初返回 404 | 排错起点，不作为当前状态 |
| 42-shanbo-rig-php-project.png | 业务站 PHP 项目和根目录 | 区分 PB 网站与管理后台反代 |
| 43-shanbo-rig-vhost-before.png | 原业务站 Nginx 配置 | 修改前核对 |
| 44-shanbo-rig-files-before.png | 原网站根目录文件 | 确认程序入口存在 |
| 45-shanbo-rig-home-recovered.png | 用户处理后网站恢复访问 | 不能归因于本轮接入补丁 |
| 46-detect-baota-pboot-site.png | 扫描识别线上 PB 站点 | 选择服务器目录 |
| 47-configure-shanbo-rig-site.png | 站点名称、根目录、数据库及 HTTPS 地址 | 业务站关联配置 |
| 48-site-link-check-passed.png | 根目录和数据库检查通过 | 接入检查 |
| 49-pull-pb-menus-confirm.png | 从 PB 获取栏目确认 | 注意同步方向 |
| 50-pb-menus-imported.png | 多语言栏目导入后 | 保留 PB 编码关联 |
| 51-initialize-products-from-pb.png | 空站点首次导入产品 | 重建会影响当前站的中央记录 |
| 52-products-imported.png | 11 个产品及缩略图 | 产品导入结果 |
| 53-news-imported.png | 新闻导入，旧缩略图缺失 | 文件缺失不能靠重复同步修复 |
| 54-pages-imported.png | 关于我们、联系我们单页 | 单页导入结果 |
| 55-video-channel-unconfigured.png | 视频频道尚未配置 | 不把此模块算作已同步成功 |
| 56-nginx-database-archive-protected.png | 首页 200、数据库与部署压缩包 404 | Nginx 数据目录防护验收 |
| 57-onboarding-code-deployed.png | 默认路径补丁构建、测试及 API 重启 | 宝塔代码部署 |
| 58-product-edit-media-verified.png | 产品缩略图、大图及轮播图 | 编辑表单媒体检查 |
| 59-existing-product-fields-linked.png | PB 自定义字段与管理中心关联 | 启用已有回拉力字段 |
| 60-template-column-links-inspected.png | CN/EN 模板编码识别 | 未知旧编码保持不变 |
| 61-template-preview-no-changes.png | 预览显示 0 个文件、0 处更新 | 已一致时无需重写模板 |
| 62-baota-scan-defaults-verified.png | 扫描默认 `/www/wwwroot`、宝塔环境 | Linux 默认值修复验收 |
| 63-site-connected-production-check.png | 接站后 HTTPS、登录、工具导航通过 | 两个工具不再要求初始站点配置 |
| 64-product-fields-verified.png | 产品编辑页面复核 | 回拉力字段 DOM 值为 185 |
| 65-live-product-detail.png | 线上 CR1000I 详情页 | 大图原文件 1564 × 1006 已加载 |

## 账号交接

用户名为 `admin@pboot.local`。初始随机密码保存在服务器 `/root/pboot-admin-initial-login.json`，权限为 `600`。通过宝塔文件管理查看该文件，或在宝塔终端本地查看；不要把文件放到网站目录、GitHub 或教程截图中。数据库初始化前备份也在 `/root`，不对外提供下载。

两个工具入口使用宝塔 HTTP Basic 认证，用户名为 `admin`。本次临时认证密码为初始化长密码的前 8 位，以适配该版宝塔的旧式目录认证限制；主后台登录仍使用完整长密码。正式长期使用建议更换为独立随机密码，或升级至支持长密码的认证方案。不要在教程中展示实际密码，也不要在 HTTP 地址上输入认证信息。

## 验收边界与后续配置

- 已选择两个独立工具域名：`seo-admin.shanbo-rig.com`、`ftp-admin.shanbo-rig.com`。
- 用户已添加两条 A 记录。公共解析器已确认 SEO 域名的 A 记录，本机 DNS 曾有缓存未及时更新；HTTP/TLS 检查以显式解析到已确认的服务器地址进行，没有跳过证书校验。
- 用户手动完成宝塔登录后，服务器补丁、生产域名环境配置、前端构建和工具重启已完成；不能重复应用同一补丁。
- 内置浏览器访问工具时不能完成 HTTP Basic 认证弹窗，返回 `ERR_INVALID_AUTH_CREDENTIALS`。已通过服务器 HTTPS 请求验证认证后 HTML 和配置接口为 200，但没有把此项算作工具全部交互和视觉验收。首次打开 SEO/FTP 请用普通 Chrome/Edge 认证；不要为截图关闭访问认证。
- 生产环境 Swagger 处于关闭状态，不能把“后端接口”链接当作已开放功能。
- 初装阶段未添加受管网站；后续已按用户要求接入下方业务站并读取其 PB 数据。模型 Key 仍未配置，没有执行 FTP 发布或付费模型调用。
- 空库的内容表为空会触发现有备份模块的“当前库有警告”；这不等于数据库文件损坏，不应为消除提示自动导入数据。
- GitHub 上传步骤已按用户要求取消，本次不提交、不推送；等功能完全跑通并再次确认后再安排。

## 已验证的代码修复

`pnpm --dir frontend build` 已通过。初始管理员和概览相关测试共 5 项通过。新增域名导航、空站点保护、部署环境更新与既有 SEO 检查/站点隔离回归共 22 项通过；`tools/verify-deployment-urls.cjs` 也已通过。测试没有连接真实 PB 站点或调用付费模型。

初装部署检查、导航、空站点与概览回归共 12 项通过，其中新增了产品介绍空站点可以离开页面、保存期间禁止离开和放弃修改确认的回归测试。产品介绍修复后的本地和服务器前端构建均通过。正式服务器 HTTPS 验收脚本也已通过。后续已执行下方 PB 到中央库的导入，但真实文章生成、中央库反向发布到 PB、文件清理和 FTP 传输尚未执行，不应写成“所有业务功能已验证”。

部署命令（在项目目录、Node 22 环境下运行）：

```sh
node deploy/configure-public-urls.cjs https://admin.shanbo-rig.com https://seo-admin.shanbo-rig.com https://ftp-admin.shanbo-rig.com
pnpm --dir frontend build
pm2 restart pboot-seo-tool pboot-ftp-tool --update-env
pm2 save
```

域名脚本只更新后台和前端相关环境变量，并保留原配置备份；不会迁移业务数据或配置模型 Key。环境文件和备份不得上传到 GitHub。

服务器上的三个前端修复文件是通过宝塔终端应用本地补丁后重新构建的，尚未提交。后续更新时先检查服务器 `git status`，不要用强制重置覆盖它们；统一上传后再核对版本和内容。

## 接入线上业务站

网站：`https://shanbo-rig.com`。管理入口：`https://admin.shanbo-rig.com/#/sites`。站点名“山博钻机”，ID 为 `1`，标识 `shanbo-rig-com`，环境为宝塔，根目录为 `/www/wwwroot/shanbo-rig.com`。数据库按该站 `config/database.php` 核对，配置保存在管理项目的 `managed-sites/shanbo-rig-com/site.json`。不要把运行配置或数据库上传到 GitHub。

1. 在站点管理扫描 `/www/wwwroot`，只导入这个业务站，保存 HTTPS 地址并检查目录、配置和数据库。
2. 从 PB 读取 32 个中文栏目和九种外语栏目，共 320 个；保留 PB 栏目编码及语言关联。
3. 从 PB 导入 11 个产品、1 篇新闻、2 个单页。导入前由服务自动备份中央库，本次没有反向覆盖 PB 内容。产品和栏目已有的外语数据一并保留；新闻未翻译状态为 0/9。
4. 读取 PB 产品字段并在中央编辑器启用已有“回拉力”。CR1000I 值为 185。11 张产品缩略图均加载，尺寸为 500 × 400；抽查 CR1000I 的大图和四张轮播图也正常。线上详情页大图 `00.jpg` 正常加载，原尺寸为 1564 × 1006。
5. 模板识别 44 个文件、15 组引用，其中 11 组 CN/EN 栏目能够匹配；预览无需改动。旧 CN 引用 105、107、110、112 暂不猜测映射，没有保存或改写模板。
6. 修复 Linux 新站及扫描窗口误用 Windows 默认目录的问题。新增服务器运行环境接口，当前站点优先，无站点时 Linux 使用 `/www/wwwroot` 和宝塔。后端针对性本地测试 10 项、服务器新增测试 4 项通过；本地和服务器前后端构建通过，API 已重启。
7. 接入时发现业务站数据库和部署压缩包可经 HTTP 访问。仅在该业务站已有 extension include 中安装 `pboot-production-guard.conf`，拒绝 `/data/` 和根目录数据库/压缩包下载。`nginx -t` 通过后重载；首页仍为 200，两个敏感地址均为 404。没有删除文件，也没有更改其他网站。
8. 再次通过三个正式域名的 HTTPS、登录、站点列表、SEO/FTP 认证与配置、跨工具导航、模型状态检查。两个工具的 `setupRequired` 均为 false。没有调用模型、执行 FTP 或自动发布。

宝塔配置和构建回退材料保存在服务器 `/www/backup/shanbo-rig-onboarding-20260911/`，目录权限 700：`nginx-before.conf` 是修改前 vhost，`admin-build-before.tgz` 保存前后端构建，另有本轮修改前的源文件。Nginx 防护实际路径为 `/www/server/panel/vhost/nginx/extension/shanbo-rig.com/pboot-production-guard.conf`。回退前核对文件及后续改动，不要整目录覆盖线上项目。

### 尚需补充的业务内容

- 唯一旧新闻引用的 `/static/codex/news/20260906/52c17cd106144aa7af38.jpg` 和正文图片 `4b3d1d1a13f55989aab0.jpg` 缺失，静态文件接口明确返回“静态文件不存在”。需要补回文件或在后台重新上传；没有擅自替换图片或修改文章。
- 首页仍有旧车辆分类内容、少量失效图片，页面 SEO 标题仍带挖掘机/滑移装载机描述。这是原站模板及内容遗留问题，不是管理中心接入失败；本轮没有自动改写业务模板或文案。
- 视频未配置本站 YouTube 频道及共享 Key；AI 模型 Key 尚未配置，SEO 自动计划保持暂停。上述实际生成、发布、视频和 FTP 业务不在本轮已验收范围。
- 网站最初 404 后由用户处理恢复。本轮只完成接入与明确列出的修复，不能将原 404 恢复写成我们修复了伪静态。
- 本轮依旧没有提交代码或推送 GitHub。教程原图保留在本目录，发布前再次检查敏感信息。

## 2026-09-12 教程栏目上线与中文站诊断

正式教程入口：`https://admin.shanbo-rig.com/#/deployment-tutorial`。已加入 Vue 顶部工具导航和两个独立工具的导航；主后台登录后可访问。共 16 章、50 步，23 张实操截图、9 张 SVG 示意图。支持搜索、箭头开关、放大、浏览器本地核对进度、下载完整 Markdown 和打印完整图文。

### 本轮新增留档

| 文件 | 内容与验证边界 |
| --- | --- |
| 66-tutorial-desktop-top.png / 66-tutorial-desktop.png | 本地隔离测试的桌面视图，不是生产截图 |
| 67-tutorial-mobile-top.png / 67-tutorial-mobile.png | 本地 390 × 844 视口测试；页面无横向溢出 |
| 68-print-01.png / 68-print-02.png | 完整教程打印 PDF 的前两页渲染，已检查首章无空白封面 |
| 69-cn-domain-license-diagnosis.jpg | PHP-CGI 返回 CN 域名未匹配官方授权；不含授权码或密码 |
| 70-transfer-check.jpg | 宝塔终端完成教程包传输，大小与 SHA-256 一致 |
| 71-stage-check.jpg | 隔离目录解压、部署脚本语法检查 |
| 72-tutorial-release.jpg | 首次发布停在 cp -an 跳过文件的非零返回，尚未切换旧前端 |
| 73-build-backup-check.jpg | 源文件前置校验、首轮 13 项测试、构建与备份核验 |
| 74-tutorial-release-success.jpg | 修正复制兼容性，14 项测试后切换新版、两个工具 online |
| 75-tutorial-live.jpg | 实际 HTTPS 生产教程页面及顶部入口 |
| 76-production-verification.jpg | 正式域名登录、工具认证、模型状态、33 个教程资源校验通过 |

原图不覆盖；发布到教程的旧 `.png` 文件如果实际为 JPEG，会保持原字节并使用正确 `.jpg` 扩展名。箭头通过页面 SVG 覆盖层实现，不写入或修改原图。测试 PDF 仅用于版式检查，不包含密码或业务数据库。

### 发布过程与回退点

1. 浏览器上传停在 0%，确认服务器不存在文件后取消该上传，改用宝塔终端传输明确选定的教程更新包。
2. 初始包共 74 个文件，加清单共 75 个；大小 2,892,878 字节，SHA-256 为 `8cedbd3b2f1cd4145372655db706fa22c0c0ebf4c8befcc0496e512f358faccf`。该校验值只对应首次包，后续修复另行更新了安装脚本、测试及教程文案。
3. 解压目录 `/www/backup/pboot-tutorial-stage-20260912`。替换前核对四个现有导航文件的前置哈希以及全部新增文件清单，发现服务器差异就停止，不强制覆盖。
4. 更新前源码和前端备份：`/www/backup/pboot-tutorial-before-20260912-044845.tgz`，权限 600。原前端目录保留为 `/www/wwwroot/pboot_admin_center/frontend/dist-before-tutorial-20260912-050419`。
5. 首轮测试与构建通过后，`cp -an` 在跳过重名资源时返回非零导致脚本停止。此时旧 `dist` 未切换。改用 Node `COPYFILE_EXCL`，只忽略 `EEXIST`，确保新资源不被旧文件覆盖，其他错误仍中止；新增回归后共 14 项通过。
6. 将新静态目录切换为 `frontend/dist`，只重启 `pboot-seo-tool`、`pboot-ftp-tool` 并保存 PM2。API、worker、业务数据库、模型 Key 和 PB 内容未修改，SEO 全局暂停未解除。
7. HTTPS 生产检查通过：后台登录及站点列表、两个工具的 401 匿名保护和认证后 200、模型状态、跨域导航。32 个教程图像与 1 份素材清单逐一校验成功。没有实际调用模型、发布文章、清理文件或执行 FTP。
8. 之后补充本次故障与验收记录并重新构建教程，仍保留旧静态资源。不重复执行首次安装脚本或原更新包。日志在 `/www/backup/pboot-tutorial-install-20260912.log`、`/www/backup/pboot-tutorial-resume-20260912.log`。

### CN 子域名 404 的独立结论

`cn.shanbo-rig.com` DNS 正确，宝塔已绑定该域名，命中正确业务 vhost，root 为 `/www/wwwroot/shanbo-rig.com`，PHP 8.2 配置正常。主域名返回 200，CN 返回 404，Nginx 语法检查与平滑重载不能解决。

直接通过同一 PHP-CGI 入口指定 CN Host 后，PBootCMS 明确返回“未匹配到本域名有效授权码”。需要网站所有者从官方获取该子域名的有效授权，在 PB 的“全局配置 → 配置参数”补充保存，不能删除原有效授权，也不能修改源码绕过校验。当前停在等待授权补充，未宣称 CN 已恢复。补充后再验证首页、栏目、详情、语言映射和切换。

宝塔登录已按用户要求保存在本机 Windows 凭据管理器，项目、截图和教程内不保存明文密码；没有提交或推送 GitHub。

## 2026-09-12 工具网页登录修复与教程更新

本节为最新状态，取代上文历史记录里的“改用外部浏览器认证”。另外，上一轮 CN 授权等待状态也已结束：负责人补充官方授权后，CN 首页、栏目及详情已验证恢复，详见在线教程“语言域名与 Nginx 修复”。本轮没有继续改 PB 站点。

### 故障与修复

1. SEO/FTP 的 HTTPS 代理和回环服务正常，但宝塔 `PbootTools /` Basic 认证在内部浏览器触发 `ERR_INVALID_AUTH_CREDENTIALS`。这不是 PHP 伪静态或项目根目录故障。
2. 新增 `tools/tool-auth.js`，生产环境用主后台完整邮箱和密码登录；每个工具有独立的 host-only 安全 Cookie。后台认证不可用时拒绝访问。保持匿名 API 401、来源校验、会话期限、退出及失败登录限流。
3. SEO 调用 FTP 的回环接口转交当前已验证身份，不共享浏览器 Cookie，不向外部地址转发凭据。
4. 先上传窄范围补丁、校验源文件与归档哈希、备份、运行测试，重启 SEO/FTP。两项回环登录页 200、匿名 API 401 后，才在宝塔两个准确项目的“全局配置 → http认证”移除旧 `PbootTools /` 规则。
5. 命令行检查通过，但实际表单登录暴露第二个问题：`Referrer-Policy: no-referrer` 导致原生表单 `Origin: null`。改成 `strict-origin-when-cross-origin`、刷新登录页后实际登录成功，保留严格来源校验。Cookie 最终为 SameSite=Lax，不将它误记为已确认的 403 根因。
6. 实际内部浏览器打开 SEO 总览、模型总览、模型配置、FTP 发布。FTP 账号和模型 Key 仍为空，本轮未调用模型、扫描网站、生成文章、发布内容、修改业务数据或传输文件。

### 留档索引

| 文件 | 内容 |
| --- | --- |
| 99-tools-basic-auth-diagnosis.jpg | 初始认证与回环服务诊断，原始留档 |
| 100-tools-proxy-targets.jpg | 宝塔反代目标与 SSL 列表 |
| 101-tools-basic-auth-setting.jpg | 修改前的 PbootTools / 认证规则 |
| 102-tools-login-gate-ready.jpg | 新保护先部署、再移除旧规则的终端记录 |
| 103-seo-basic-replaced.jpg / 104-ftp-basic-replaced.jpg | 分别移除准确项目的旧认证规则 |
| 105-seo-browser-login.jpg / 106-ftp-browser-login.jpg | 空白可见登录表单，无账号密码 |
| 107-seo-browser-ready.jpg / 108-ftp-browser-ready.jpg | 真实网页登录后的页面 |
| 109-tools-production-check.jpg | 初轮生产验收；其后仍做了实际浏览器表单修复 |
| 110-models-browser-ready.jpg / 111-model-config-browser-ready.jpg | 模型总览与配置实际打开，无 Key |
| 112-tools-final-verification.jpg | 最终认证测试和正式域名验收通过 |
| 113-tools-tutorial-live.jpg | 正式 Vue 教程截图放大、箭头标注检查 |
| 114-tools-tutorial-upload.jpg / 115-tools-tutorial-release.jpg | 通过宝塔上传、构建并发布教程 |
| 116-tools-source-media-check.jpg | 6 个工具源码与本地一致，56 个线上素材及清单哈希通过 |

教程选用其中 11 张已检查截图，原字节不改，箭头由页面 SVG 覆盖层生成。新增 `tool-session-flow.svg`，并更新旧认证流程图。当前教程合计 **17 章、64 步、45 张实操截图、11 张 SVG**。直接入口：<https://admin.shanbo-rig.com/#/deployment-tutorial?chapter=tool-access>。

### 测试、发布与回退

- 认证与生产验收脚本共 17 项测试在本地及服务器通过；加上教程、导航、空站点回归共 34 项本地测试通过。Vue 类型检查及本地/服务器构建通过。生产验收覆盖登录、匿名拒绝、导航、模型状态、SEO/FTP 身份联动及退出，不代表业务写入已验收。
- 工具更新前备份：`/www/backup/pboot-tool-auth-before-20260912033506857/before.tgz`。原补丁后追加的 Cookie 与 Referrer-Policy 修复已同步本地源码，原初次归档不代表最终版本；不要重新覆盖已修好的代码。
- 本轮教程包：`pboot-tutorial-tools-login-20260912.tgz`，6,207,289 字节，SHA-256 `640566b1b152309edabe91c5661988f126b5ef9e38c7aa8c463687855f1461ae`。只更新教程文件和前端静态资源，未重启 API、worker 或工具。
- 教程更新前备份：`/www/backup/pboot-tutorial-before-20260912-123819.tgz`；旧静态目录：`frontend/dist-before-tutorial-20260912-123844`。发布日志：`/www/backup/pboot-tutorial-tools-login-20260912.log`，含 `TUTORIAL_RELEASE_COMPLETE`。
- 认证回退必须先恢复全路径保护，再恢复旧版工具。教程回退只针对源码和前端；不回滚业务数据库。保持所有备份在非公开目录。
- 本次没有 Git 提交或 GitHub 推送。
- 最终 HTTPS 检查逐项读取 56 个教程素材并核对 SHA-256，在线素材清单与本地一致；6 个已部署认证相关源码指纹也与本地一致。内部浏览器实际打开新版章节与登录截图放大弹窗，箭头对准表单字段。

## 2026-09-12 产品生成PDF：多语言与完整详情

本轮不生成额外参数表，导入产品的整个 `content` 字段，自由增删正文和图片；保留原文已有表格及旧资料兼容。资料与 PB/产品库独立，十种站点语言按现有译文读取，缺译不回退中文。

| 截图 | 操作记录 |
| --- | --- |
| 117-pdf-backup-fonts.jpg | 功能更新前备份及语言字体检查 |
| 118-pdf-upload-package.jpg | 宝塔文件管理确认上传成功 |
| 119-pdf-registry-recovery.jpg | npm 镜像 404 和安装失败恢复 |
| 120-pdf-release-ready.jpg | 程序测试、构建、域名和登录检查 |
| 121-pdf-language-options.jpg | 当前站点语言选择 |
| 122-pdf-english-import.jpg | 英文产品、关联栏目与翻译状态 |
| 123-pdf-full-detail-editor.jpg | 完整正文编辑；此截图早于预览相对地址修复 |
| 124-pdf-sandbox-probe.jpg | pbootpdf 低权限沙箱探测成功 |
| 125-pdf-emoji-fonts.jpg | Linux Emoji 字体安装及匹配 |
| 126-pdf-export-completed.jpg | 正式页面点击导出后的状态，仅作原始记录 |

- 功能发布备份：`/www/backup/pboot-pdf-release-20260912065919789`，未迁移数据库、未改 PB，worker 未重启。
- 根进程浏览器问题通过专用 `chromium-pdf-sandbox.sh` 降权解决，保留沙箱；环境备份为私有文件，不纳入教程素材。
- 实际正式英文 CR1000I 导出 12 页 A4，Poppler 检查页面尺寸并渲染，核对正文、图片、尾页与 Emoji。测试草稿未写入业务库。
- 另修复 `/api` 相对图片地址在预览中被省略的问题，并补对应回归测试。旧稿缺少 `imageSize` 时，界面也明确选中“大图”。
- 后端 43 项测试、界面隔离测试及四种语言长正文分页检查通过。本轮不提交 Git，不推送 GitHub。
