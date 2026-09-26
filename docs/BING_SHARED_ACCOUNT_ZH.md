# Bing 多网站共享配置与三步操作

## 日常操作

打开 `http://localhost:5388/bing.html`，确认当前网站。

1. 首次使用或新增页面：点击“先：生成并上传”，完成后点击“再：提交网站地图”。上传使用当前网站已保存的 FTP 配置，只使用现有 SEO 文件发布范围。
2. 点击“通知当前网站的页面”，通过 IndexNow 按域名分组通知当前项目各语言网址。失败时显示具体域名，并可仅重试失败域名。接收通知不代表已收录。
3. 过几天在 Bing 查看收录。单页 API 查询只返回抓取资料，不能据此认定已收录或未收录。

## 一次配置，多网站共用

在“账号配置”中保存 Bing Webmaster API Key，默认勾选“保存为共享配置”。新项目没有专用 Key 时自动使用共享配置。每个网站必须在该 Bing 账号下单独添加并验证；点击“测试当前网站权限”核对确切网站地址与验证状态。

已有专用 Key 的项目保持原配置，可选择“使用已有共享配置”或“将当前专用配置改为共享”。更新共享 Key 会影响所有选择共享的项目；保存前会提示。停用只影响当前网站，不删除共享凭据。

共享凭据：`managed-sites/_shared/bing/account.json`。原子写入，状态接口不返回 Key。此文件已被 `managed-sites/*` Git 忽略规则和代码发布排除规则覆盖，不随代码自动部署。线上使用时应在对应环境配置凭据。

各网站的 `bingWebmaster.accountSource` 可为 `shared`、`site`、`disabled`。旧配置没有来源但有 Key 时按专用配置处理。域名、XML 验证码、IndexNow Key、FTP 设置仍保存在各自的网站配置中，不共享。

## 接口与验证

- 网站地图使用微软 `SubmitFeed` 接口与 `feedUrl` 参数。
- 网站权限使用 `GetUserSites`，核对当前站点的 `Url` 和 `IsVerified`。
- 单页资料使用 `GetUrlInfo`。`IsPage` 不等于已收录，API 返回 `indexed: null`，界面指引到 Bing URL 检查确认。
- API 故障、非 JSON 响应与网络错误不能显示为成功，也不会在错误信息中返回密钥。
- 定向测试：`node --test tools/seo_publish_tool/bing-api.test.cjs tools/seo_publish_tool/bing-shared-account.test.cjs`。

2026-09-23：用户已保存共享 Key。当前网站权限、通过本地 API 提交 Sitemap、GetUrlInfo 首页查询均已实际通过。首页返回抓取时间 2026-09-19T08:09:27.000Z；不据此宣称已收录。

官方说明：[账号 Key 可用于同账号所有已验证站点](https://learn.microsoft.com/en-us/bingwebmaster/getting-access)、[SubmitFeed](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.submitfeed?view=bing-webmaster-dotnet)、[GetUrlInfo](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.geturlinfo?view=bing-webmaster-dotnet)、[IndexNow](https://www.indexnow.org/documentation)。

## API Key 配置实拍教程

Bing 页面下方的“使用教程”已内嵌以下实际操作截图，可点击放大。

1. Bing 右上角齿轮 → API 访问。

![打开设置与 API 访问](../tools/seo_publish_tool/public/tutorials/bing-api-settings-live.png)

2. 选择“API 密钥”，无需创建 OAuth 客户端。

![选择 API 密钥](../tools/seo_publish_tool/public/tutorials/bing-api-access-live.png)

3. 没有 Key 时生成一次，已有 Key 则直接复制。新增网站无需重新生成。

![生成 API 密钥入口](../tools/seo_publish_tool/public/tutorials/bing-api-generate-live.png)

4. 回到本地 Bing 页 → 账号配置 → 粘贴完整 Key → 勾选共享 → 保存配置 → 测试当前网站权限。截图中不展示密钥内容。

教程直达：`http://localhost:5388/bing.html?siteId=1#bing-permission-tutorial`。

## 全流程测试修正（2026-09-23）

- 原生浏览器确认框影响自动操作：上传与 IndexNow 按钮改用页内确认框，保留“取消”和“确认继续”；Bing 错误直接显示在结果区。
- 网址来源：本地默认语言为 CN，不能因此推断线上主域名也属于 CN。优先读取 PB 区域管理 `ay_area.domain`，本项目中文为 `cn.shanbo-rig.com`，英文为 `shanbo-rig.com`，不再生成错误的 `en.shanbo-rig.com`。已有域名配置为本地域名或格式错误时阻止提交。
- Bing 的 IndexNow 通知只提交到公共入口一次，由协议分发给参与引擎，不再串行等待额外的 Yandex 请求；Yandex 页原有行为不变。
- FTP 状态查询偶发超时不等于上传失败：增加查询等待时间并容忍两次连续查询失败；真正无法确认时明确提示后台可能仍在上传。成功时清除“正在上传”的旧提示。
- IndexNow HTTP 202 表示平台验证中，不再计入成功域名和成功网址数；“重试未完成域名”只重试未完成项，已通过的域名不会跟着重发。
- 共享凭据不变，未修改远程服务器配置和网站数据库。网址修正影响后续所有搜索引擎共用的网站地图生成。
- 回归测试补充：`node --test tools/seo_publish_tool/language-url.test.cjs tools/seo_publish_tool/bing-api.test.cjs tools/seo_publish_tool/bing-shared-account.test.cjs`，11 项通过。
- IndexNow 返回状态测试：`node --test tools/seo_publish_tool/indexnow-response.test.cjs`，4 项通过，覆盖 200、202、平台验证中和无效 Key。

实际上传复测：14 个文件上传成功、0 个失败。线上 sitemap 包含 10 个正确域名、761 个网址；修正后的 sitemap 已重新提交给 Bing 并被接收。

最终 IndexNow 复测：10 个域名、761 个网址全部返回已接收，未完成 0 个。中文域名首次返回 202，稍后复测已通过。这里记录的是通知接收结果，不是收录数量。页面控制台未发现运行错误。

![全部语言更新通知已接收](../tools/seo_publish_tool/public/tutorials/bing-indexnow-result-live.png)

![SEO 文件上传完成](../tools/seo_publish_tool/public/tutorials/bing-upload-success-live.png)

![共享账号网站权限通过](../tools/seo_publish_tool/public/tutorials/bing-shared-permission-live.png)

![网站地图 API 提交成功](../tools/seo_publish_tool/public/tutorials/bing-sitemap-api-success-live.png)

![首页抓取资料查询](../tools/seo_publish_tool/public/tutorials/bing-url-query-success-live.png)
