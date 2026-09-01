# PbootCMS SEO 检查工具

这个工具负责检查 SEO 问题、生成公开 SEO 文件，并提供 Google Search Console 和 IndexNow 的发布入口。

## 启动

双击当前目录中的 `启动SEO工具.bat`。浏览器会自动打开工具页面，端口以当前网站的 `seo.config.json` 为准。

每个 PbootCMS 网站应保留自己的工具目录与配置，不共用数据库路径、端口或密钥。

## 主要功能

- 检查栏目、单页、新闻和产品的 SEO 问题。
- 实际抓取本地或线上页面，检查 HTTP 响应、标题、描述、Canonical、H1、收录指令、图片 ALT、Hreflang、Open Graph、结构化数据和移动端配置。
- 计算可解释的 SEO 健康度，并显示无问题记录和待关注记录数量。
- SEO 问题可按风险、语言、内容类型和关键词筛选，并可导出 CSV 或复制诊断摘要。
- 视频不参与 SEO 检查，新闻不检查 URL 名称。
- 生成网站根目录下的 `sitemap.xml` 和 `robots.txt`。
- 检查线上 sitemap、robots 是否公开可访问。
- 打开 Google Search Console 的 Sitemap 和网址检查页面。
- 使用 Google Indexing API 按每日配额分批提交 URL，保存成功记录并在下次从未提交 URL 继续。
- 读取 Search Console 中的 Sitemap 处理状态和搜索表现，并按页面价值建立收录诊断优先队列。
- 批量调用 URL Inspection 查询真实索引状态，缓存结果并给出 robots、noindex、抓取、404 和 canonical 修复建议。
- 生成并提交 IndexNow Key，通知 Bing 等支持 IndexNow 的搜索引擎。
- 在一个页面完成 SEO 文件生成、仅上传 SEO 文件、等待 FTP 完成和线上校验。
- 显示当前项目根目录、数据库、公开域名和端口，防止误操作其他网站。

## 推荐操作顺序

1. 先查看页面顶部的“当前项目身份”，确认站点名称、网站根目录、数据库、真实域名和端口都属于当前网站。
2. 点击“一键准备 Google Sitemap”。工具会重新生成 SEO 文件、调用当前网站自己的 FTP 配置仅上传 SEO 文件，并等待上传结束。
3. 等线上检查显示 `sitemap.xml` 与 `robots.txt` 都是 HTTP 200，Sitemap XML 有效且 URL 数量大于 0。
4. 新网站或第一次部署时，复制 Sitemap 线上地址，打开 Google Search Console 的 Sitemaps 页面提交一次。
5. 新增重要新闻、产品或大幅修改页面后，复制真实 URL，打开“网址检查”，粘贴 URL 后点击“请求编入索引”。
6. 平时只需保持 Sitemap 可访问并定期查看 Search Console 的“网页”“视频”“网站使用体验核心指标”和服务器日志。

## Google 收录流程

生成 Sitemap、检查线上文件和手动打开 Search Console 都不需要 Google Cloud 或服务账号。普通新闻和产品页面没有可以绕过 Search Console、直接强制 Google 收录的公开 API。

如需在工具内提交 Sitemap、调用 URL Inspection 或使用 Indexing API 断点续传，可以配置 Google 服务账号。同一份账号会按功能申请不同的访问令牌。

Google Cloud 中必须分别启用 **Search Console API** 和 **Indexing API**。只启用 Indexing API 时，一键通知仍可使用，但 Sitemap 状态、搜索表现和 URL Inspection 会返回 403；页面中的“启用 Search Console API”可直达对应 API 页面。

Google 官方当前只支持将 Indexing API 用于带 `JobPosting` 或带 `BroadcastEvent` 的直播页面。工具保留完整提交能力并显示该提示；普通新闻和产品页仍应以 Sitemap、内部链接和 Search Console 为主。

推荐流程：

1. 在工具中填写真实线上地址并保存。
2. 点击“生成 sitemap + robots”。
3. 将 `sitemap.xml`、`robots.txt` 和 IndexNow Key 文件上传到真实网站。
4. 点击“检查线上 sitemap / robots”，确认返回 HTTP 200 且内容有效。
5. 复制 Sitemap 地址，打开 Search Console 的 Sitemaps 页面，提交一次。
6. 重要的新页面或大幅修改的页面，可复制真实 URL，打开 Search Console 的网址检查，粘贴后点击“请求编入索引”。

Sitemap 提交成功只表示 Google 已收到地址，不保证立即抓取或收录。持续可访问的页面、正确的内部链接、稳定的服务器和高质量内容更重要。

### Google Indexing 断点续传

1. 页面会读取 `google-submitted.json`，自动跳过已有成功记录的 URL。
2. 默认每日提交限额为 200，可在页面保存项目自己的本地限额。
3. 每个实际 publish 请求都会立即写入今日计数，成功后同时写入 URL 提交记录。
4. 遇到 429、所有权 403、本地配额耗尽或手动停止时会保留进度；配额重置后再次点击即可继续。
5. 也可运行 `npm run submit:google` 执行一次无人值守续传，脚本只选择未提交 URL，并按今日剩余额度截断；先运行 `node auto-submit-google.js --dry-run` 可做不消耗配额的演练。

### Search Console 收录诊断

1. “读取 Sitemap 处理状态”会显示 Google 最后读取时间、待处理状态、错误、警告和 Sitemap 中的 URL 数量。
2. “读取搜索表现”会读取近 7、28 或 90 天的页面点击、曝光、CTR 和平均位置；有搜索曝光的页面会提高诊断优先级。
3. 批量诊断优先检查各语言首页、栏目页、高 Sitemap 优先级页面、近期更新页面和有搜索曝光页面。
4. 每个成功的 URL Inspection 结果会写入本地 `google-inspections.json`，包含真实索引状态、抓取时间、robots、canonical 和下一步建议；停止或刷新后可从未检查 URL 继续。
5. 默认缓存有效期为 7 天，可改为 14、30 天或总是重查。Google 官方 URL Inspection 单站配额为 2000 次/天、600 次/分钟，工具单批最多 100 条并控制请求速度。

### Google 状态含义

- **已提交**：Sitemap 已交给 Google，只代表 Google 收到地址列表。
- **已发现**：Google 已知道这个 URL，但可能还没有访问。
- **已抓取**：Googlebot 已访问页面，但仍可能暂不建立索引。
- **已编入索引**：页面进入 Google 索引，才有机会出现在搜索结果中。

### 必须手动完成的步骤

以下操作受 Google 登录、站点所有权、权限或验证码保护，工具不能代替用户点击：

- 首次在 Search Console 验证网站所有权。
- 首次提交 Sitemap。
- 在“网址检查”中为少量重要页面点击“请求编入索引”。
- 查看 Google 给出的未收录原因并按实际原因处理。

普通新闻和产品页面没有合法的“强制整站立即收录”接口。工具页面已经提供对应入口、待检查 URL 和逐步文字教程。

## IndexNow

IndexNow 通知 Bing 等支持该协议的搜索引擎，不等于提交给 Google。提交前必须：

- 使用真实线上域名，不能使用 localhost 或本地测试域名。
- 确保每个提交域名都能公开访问对应的 Key 文件。
- Key 文件内容与工具当前生成的 IndexNow Key 完全一致。

## 百度收录（中文站）

百度不认 IndexNow，是中文站 cn.shanbo.cc 的独立入口。工具内置了百度「主动推送」实时 API：

1. 打开百度搜索资源平台(ziyuan.baidu.com)，添加 cn.shanbo.cc 并完成验证。
2. 进入「普通收录 → 主动推送」，复制接口地址里的 token。
3. 在工具「百度收录」面板粘贴 token 保存，点「推送中文站全部 URL」。
4. 也可每日运行 `node auto-submit-baidu.js` 自动推送中文站 URL（重复推送会被当作内容更新，无需去重）。

注意：未备案的 .cc 域名百度收录会偏慢，主动推送能提交上去但不保证立即收录。每日配额以百度返回的 remain 为准。

## 国内其它搜索引擎

360、搜狗、神马、头条没有稳定的公开实时推送 API，需在各自站长平台验证后提交一次 sitemap：

- 360 搜索：zhanzhang.so.com
- 搜狗搜索：zhanzhang.sogou.com
- 神马搜索：zhanzhang.sm.cn（移动端）
- 头条搜索：zhanzhang.toutiao.com

工具「国内其它搜索引擎」面板会列出各平台入口和当前 sitemap 地址。

## 多语言 hreflang（sitemap）

工具生成 sitemap.xml 时，会为每个 URL 输出跨语言的 `<xhtml:link rel="alternate" hreflang="...">` 与 `x-default`，声明 7 个语言版本之间的对应关系（英文主域无前缀，其余语言以 `{lang}-` 前缀区分）。这是 Google/Bing 多语言收录的标准声明方式，无需在页面里再写 hreflang。

## 安全和迁移

- `seo.config.json` 保存当前网站路径、端口和公开域名。
- AI Key、FTP 密码等敏感配置不要放进公共压缩包。
- 迁移到新电脑或新网站时，应重新运行配置向导，并选择该网站自己的数据库和公开域名。
- 数据库备份目录不要上传到公开网站。

## 适配其他 PbootCMS 网站

每个网站必须使用自己独立的一份 `pboot_admin` 工具目录，不要让两个网站共用配置文件、SQLite 数据库或端口。

迁移到新网站后按以下顺序操作：

1. 将整套管理工具复制到新 PbootCMS 网站目录下。
2. 运行配置向导，重新选择新网站根目录和 `data` 目录中的 SQLite 数据库。
3. 填写新网站的本地测试地址、真实线上地址和独立端口。
4. 配置该网站自己的 FTP，不要复制旧网站保存的密码。
5. 启动后先核对 SEO 页面“当前项目身份”；任何一项仍显示旧网站时立即停止操作并重新配置。
6. 点击“一键准备 Google Sitemap”，确认生成文件、FTP 上传和线上检查都针对新域名。
7. 在新域名自己的 Search Console 资源中提交 Sitemap。

建议同一台电脑上为不同网站分配不同端口，例如后台前端 `5173/5174`、NestJS `5008/5009`、SEO 工具 `5288/5290`、FTP 工具 `5289/5291`。页面显示的配置端口和实际运行端口必须一致。
