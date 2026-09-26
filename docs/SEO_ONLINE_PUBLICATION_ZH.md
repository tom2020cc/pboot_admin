# 宝塔线上 SEO 文件生成

2026-09-23：线上 Bing 页面点击“生成并上传”报 FTPS 数据连接 TLS decode error。原流程先在当前站点根目录生成 SEO 文件，再无条件连接 FTP，导致宝塔同机发布绕回 FTP。

修正 `/api/publish/online`：后端以部署环境为准，`APP_ENVIRONMENT=baota` 时直接生成 sitemap、robots 和各语言 IndexNow 验证文件到当前站点目录，返回 `mode: direct`；本地继续调用 FTP 上传和状态轮询。线上直接生成失败会报错，不会退回 FTP 或关闭 TLS 校验。

Google / Bing 共用该发布逻辑，线上按钮显示“先：生成线上文件”，仍会在生成后检查公网文件。账号、数据库、网站内容和服务器 TLS 配置不受本次修正影响。

验证：`node --test tools/seo_publish_tool/seo-publication.test.cjs`，覆盖线上不调用 FTP、本地保留 FTP，以及线上写入失败不会被误报成功。前后端 JavaScript 语法检查通过。

上线仅更新 SEO 工具 `server.js` 与 `public/index.html`，并重启 `pboot-seo-tool`。

2026-09-23 17:17：线上语法检查、PM2 重启及健康检查通过。该主机现有 PM2 使用 `/root/.pm2`，Node 位于 `/www/server/nvm/versions/node/v22.23.2/bin`。首次临时重启命令的目录解析异常造成等待，已停止该次无效命令与其新起的空守护进程，并使用核实后的原 PM2 实例完成重启。管理后台、FTP 与内容工作进程未重启。

工具登录会话保存在进程内存，SEO 重启后需要重新登录再做按钮验收。

用户重新登录后，线上页面已显示“线上 SEO 文件已生成／已直接生成到当前宝塔网站目录，无需 FTP 上传”，同时显示 Bing 已接收网站地图。公网 sitemap 返回 HTTP 200，包含 761 个网址。页面验收通过。

![线上直接生成及地图提交成功](../tools/seo_publish_tool/public/tutorials/bing-online-direct-publication-live.png)
