# Yandex 俄语站收录

入口：本地 SEO 工具 → Yandex（默认 `http://localhost:5388/yandex.html`）。

## 首次配置

1. 在区域管理配置 RU 的线上域名，并同步俄语栏目到 PB。Yandex 页面从当前项目的俄语网址读取域名，不使用英文主站代替。
2. 在 Yandex Webmaster 添加完整地址，例如 `https://ru.shanbo-rig.com/`。HTTP、HTTPS 和其他子域名是不同属性。
3. 完成网站所有权验证。HTML 方式：复制平台的文件名、完整内容到本页“俄语站配置 → 使用 HTML 验证文件”，保存后点击“先：生成并上传”，最后回 Yandex 点击 Verify。
4. 在 Yandex OAuth 创建“API access or debugging”应用，选 `webmaster:hostinfo` 和 `webmaster:verify`。授权后将 Token 保存到本地页面，点击“测试俄语站权限”。

![HTTPS 俄语站已通过所有权验证](../tools/seo_publish_tool/public/tutorials/yandex-ru-verified.png)

## 多网站共享账号

首次保存时勾选“保存为共享账号”。之后新增网站不必重新申请 Token，在同一个 Yandex 账号添加并验证该网站，再点“测试俄语站权限”即可。旧网站的专用 Token 保留，可手动改用共享账号。

### 新网站具体怎么做

共享账号就是复用本系统存好的通行凭证；单独验证就是向 Yandex 证明新域名也是你的。例如山博的 `ru.shanbo-rig.com` 已验证，以后新增 `ru.example.com`（仅为示例）不用再申请 Token，但新域名需要验证一次。日常内容更新不必重复验证。

1. **选中新网站**：在管理后台切换当前网站，配置“区域管理”的 RU 线上域名，打开该网站的“SEO 检查 → Yandex”。网站需已经上线，发布连接已配置。
2. **确认共用账号**：展开“账号与俄语站配置”，看到“共享账号已配置”即可，不用填 Token，也不用再点“保存配置”。原来用专用账号的网站，可点“使用已有共享账号”。
3. **在 Yandex 添加新域名**：点击“打开 Yandex 添加 / 验证网站”，使用共享 Token 对应的同一个账号登录，点击 Add，填写新网站完整地址，例如 `https://ru.example.com/`。不要填旧网站地址，HTTP/HTTPS 要一致。
4. **保存新网站的验证文件**：选择 HTML file 验证，下载并打开 Yandex 提供的文件。回本页“使用 HTML 验证文件”，填写文件名及完整内容，点击“保存验证文件”。使用新网站这次提供的文件，不要直接复制山博示例。
5. **上传并验证**：点击“先：生成并上传”，完成后回 Yandex 点 Verify / Check，看到验证通过或 Owner。已通过 DNS 或标签验证的网站可跳过第 4、5 步。
6. **测试网站权限**：回本页点击“测试俄语站权限”，确认“俄语站权限已通过”。失败时核对账号、完整域名和验证结果，不要反复申请 Token。
7. **提交页面**：文件未生成上传时先点“先：生成并上传”，再点“再：提交网站地图”。内容更新后点“通知俄语站页面”，成功后等待抓取，过几天查看结果。

如果显示“共享账号尚未配置”，先确认是否打开了同一套管理系统。另一台电脑、线上管理后台不会自动获取本地密钥；线上可在“网站发布 → 代码与配置同步 → 项目配置同步”勾选“Google / Bing / Yandex 共享账号”后同步，再刷新。第一次配置 Token 的操作只需做一次，不需要每新增一个网站都重做。

授权时核对账号显示名，不能仅凭手机号判断当前身份。本次 `.ru` 入口和 `.com` 入口沿用了不同登录账号，只有 Webmaster 网站所有者账号的 Token 才返回已验证站点。使用 [国际 OAuth 入口](https://oauth.yandex.com/) 后，确认授权页为网站所有者，再保存 Token 并测试。

![授权前核对网站所有者](../tools/seo_publish_tool/public/tutorials/yandex-account-authorization.png)

![共享账号设置入口](../tools/seo_publish_tool/public/tutorials/yandex-shared-account.png)

## 日常三步

1. **提交网站地图**：先生成并上传，再提交。系统生成 `sitemap-ru.xml`，只包含 RU 域名的页面和首页。提交前检查线上地图与站点权限。
2. **主动通知更新**：俄语内容有变化时使用 IndexNow；按俄语站限定提交，不把其他语言混入。接收通知不代表收录。
3. **查看结果**：到 Yandex Webmaster 查看索引、抓取与搜索表现，无需每天重复提交。

## 实现与限制

- 使用官方返回字段 `ascii_host_url` / `unicode_host_url`，按完整 origin 匹配并要求 `verified: true`。
- Sitemap 使用 `POST /v4/user/{user-id}/hosts/{host-id}/user-added-sitemaps`；需要 201 及 sitemap_id 才确认新增成功，409 已存在则提示无需重复添加。
- 默认勾选“保存为共享账号”，Token 单独保存在 `managed-sites/_shared/yandex/account.json`，未设置专用账号的新网站自动复用。已有项目的专用 Token 不会自动迁移；可以点击“将当前专用账号设为共享”或“使用已有共享账号”。域名、验证文件和 host_id 仍按项目保存。
- “停用当前网站 API”只停用该站，不删除共享 Token，不影响其他网站。常规 JSON 响应不返回 Token；主动导出的专用配置包仍可能含凭证，应妥善保管。
- 发布到线上时，在“项目配置同步”明确勾选“Google / Bing / Yandex 共享账号”；默认代码同步不携带密钥。本次只完善同步支持，没有自动部署或上传共享账号。
- 保存/清除验证文件配置不会覆盖 Token；更新 Token 会清除旧账号缓存，测试时重新读取当前账号和权限。
- 更换共享 Token 后，提交时重新向 API 查询账号和已验证站点；不会使用另一个项目的缓存 host_id。共享不是免验证，每个新网站仍要在同一个 Yandex 账号下完成所有权验证。
- 网络失败最多自动重试一次只读请求；提交请求不自动重试，避免未确认结果时重复发送。
- 本地代码改动不等于线上管理工具已部署。测试只发布网站地图与验证文件，不发布管理项目代码、数据库或环境配置。

官方参考：[OAuth](https://yandex.ru/dev/webmaster/doc/ru/tasks/how-to-get-oauth)、[站点列表](https://yandex.ru/dev/webmaster/doc/en/reference/hosts)、[提交 Sitemap](https://yandex.ru/dev/webmaster/doc/en/reference/host-user-added-sitemaps-post)。

## 2026-09-24 实测记录

- HTTPS 俄语站 HTML 所有权验证通过；线上 `sitemap-ru.xml` 返回 200，包含 77 个俄语网址。
- 修正分组范围后的 IndexNow 页面测试：接收 1 个域名、77 个 URL。
- 首轮实测暴露旧分组带入其他语言的问题，已修正并增加服务端范围回归测试。修正前的部分通知已被接收，不将其当作俄语站测试结果。
- 初始 OAuth Token 有效但网站列表为空，原因是授权账号与 Webmaster 所有者不一致。已通过国际 OAuth 入口授权网站所有者 Tom2026 Fox，保存为共享账号，俄语站权限实测通过。
- 本地共 19 项相关测试通过（Yandex、Bing、百度及发布分流）。
- 新增共享账号后，26 项针对性测试通过（Yandex API、共享凭证隔离及项目同步）；浏览器已核对共享设置界面。同步测试使用临时目录和模拟远端，没有向线上上传凭证。
- 正确共享账号保存后，从本地页面点击“测试俄语站权限”通过，再点击“再：提交网站地图”，实际 API 返回成功，页面显示“Sitemap 已提交给 Yandex”。地址为 `https://ru.shanbo-rig.com/sitemap-ru.xml`；接收不代表已收录。

![本地页面提交成功](../tools/seo_publish_tool/public/tutorials/yandex-sitemap-success.png)
