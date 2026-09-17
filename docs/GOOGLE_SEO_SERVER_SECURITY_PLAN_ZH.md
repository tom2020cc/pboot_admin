# Google SEO 与宝塔安全巡检实施清单

记录日期：2026-09-14。核心功能已在宝塔上线，以下先列实际验收结果，再保留初始设计清单。不能将设计目标全部当作已验证能力。

## 实际验收

- DeepSeek：服务器真实探测 605ms、一次成功，网页约 0.3 秒；详见 [连接排障](DEEPSEEK_CONNECTION_ZH.md)。
- Google：Sitemap PUT 改为官方 webmasters/v3；提交前检查属性权限和当前网站范围。令牌按网站、账号、私钥指纹、scope 隔离，not indexed 不再误判为已收录，通知记录不等于索引状态。
- 普通产品/新闻不使用 Indexing API；招聘/直播专用入口折叠，提交前核对真实页面 JSON-LD 类型。
- 公开文件：原 robots 缺少 Sitemap 声明，本轮保留原规则，仅追加 `Sitemap: https://shanbo-rig.com/sitemap.xml`。网页复测 Sitemap/robots 均 HTTP 200，44 条公开 URL；没有重新生成全站文件。
- SEO 报告：425 条栏目/内容记录、435 条 URL、1024 项提示（高 4、中 300、提示 720）。首页实际技术体检 76 分，缺少 H1，8 张图片缺少有效 ALT。检查器分数不是 Google 官方评分。未自动改写现有内容。
- 服务器巡检：读取当前受管网站 rootPath，定时默认关闭，支持停止、限额、历史、下载和人工采用指纹基线。扫描只读，不删除、隔离或清理文件。
- 复扫 1191 个文件，高风险 0、需关注 1、未读取 1。`core/basic/Kernel.php` 编码提示待与相同版本可信来源核对；`shanbo-rig.c.zip` 超过 8MB 未读，且规则引擎不解压扫描 ZIP 内部。
- 初次 12 张 JPEG 的随机二进制 PHP 标记误报已修正，真实脚本注入样例仍能命中，新增回归通过。不要把高风险 0 写成“服务器无病毒”。
- 本轮增量修正服务器 66 项测试通过，覆盖连接格式与超时、站点隔离、Sitemap 权限/403/空成功响应、索引分类、巡检越界/限额/停止/基线等。未覆盖原计划所有场景，例如严格 XML 文法验证。
- 没有代码备份或 GitHub 上传，没有导入产品、修改文章或迁移数据库。只重启本次相关的 SEO/FTP 工具，主 API 和内容 worker 保持运行。

## 操作入口

1. [Google 配置](https://seo-admin.shanbo-rig.com/google.html?siteId=1)：核对站点 → 配置并验证服务账号 → 检查线上文件 → 提交 Sitemap → 查看索引/搜索表现。
2. [SEO 体检](https://seo-admin.shanbo-rig.com/audit.html?siteId=1)：选择真实页面 → 开始体检。不要误点会直接落库的 AI 修复按钮。
3. [服务器巡检](https://ftp-admin.shanbo-rig.com/server-security.html?siteId=1)：核对域名及根目录 → 手动扫描 → 检查风险和未读文件。完整且可信后才允许采用指纹基线。
4. [部署教程](https://admin.shanbo-rig.com/#/deployment-tutorial)：新增 Google SEO/DeepSeek 与宝塔安全巡检章节，保存真实截图并叠加箭头，无法代用户授权部分使用 SVG 示意。

## 尚未完成或需负责人处理

- Google 服务账号尚未配置。需网站所有者在 Google Cloud 启用 Search Console API，建立服务账号，并在 Search Console 验证目标网站、授予完整权限。真实 Google 提交、账号下索引查询及搜索表现数据均未验收，不能冒充已推送或已收录。
- 当前公开 Sitemap 44 条，数据库候选 435 条；两者不相等。扩展前应先确认已上线语言、页面可访问性、canonical 和多语言对应关系，本轮未全站重新生成或覆盖。
- 官网模板 H1 与图片 ALT、现有内容配置问题需要逐项审核。本轮按“不自动改旧数据”限制保留。
- ClamAV 未安装，当前仅 heuristic-v1 规则和指纹，不具备病毒库查杀、压缩包内部扫描或自动隔离功能。定时保持关闭，基线未采用。

## Google 服务账号步骤

1. 用网站所有者账号在 Search Console 验证属性。域名属性如 `sc-domain:shanbo-rig.com` 覆盖语言子域名；网址前缀属性如 `https://cn.shanbo-rig.com/` 严格匹配协议、主机和路径。
2. Google Cloud 选定项目，启用 Search Console API，创建服务账号；不授予不必要的项目管理员角色。在服务账号“密钥”中创建 JSON，保存在非公开位置。
3. 在 Search Console 对应属性的“设置 → 用户和权限”中添加 JSON 的 `client_email`，授予完整权限。私钥不放网页截图、聊天或 GitHub。
4. 当前网站的 Google 页面保存完整 JSON，再测试 Search Console 属性权限。只拿到 access token 不能证明有网站权限。
5. 检查公开 Sitemap/robots，保存正确属性与地址，提交 Sitemap，读取处理状态。URL Inspection 是读取索引诊断；少量重要页面请求收录需要到 Google 官方页面操作。

## 现场截图

![发布与 66 项测试通过](tutorial-assets/baota-2026-09-11/182-google-refinement-release.jpg)
![公开文件检查通过与账号待配置](tutorial-assets/baota-2026-09-11/185-google-public-files.jpg)
![首页实际技术体检](tutorial-assets/baota-2026-09-11/186-seo-homepage-audit.jpg)
![服务器只读扫描结果](tutorial-assets/baota-2026-09-11/183-server-scan-refined.jpg)
![风险和未读取项](tutorial-assets/baota-2026-09-11/184-server-scan-details.jpg)

## 初始设计顺序（历史）

1. 完成 DeepSeek 修复部署及线上回归。
2. 回归 SEO 检查、Google 配置和提交工作流。
3. 为 FTP 工具增加直接检查宝塔网站目录的巡检入口。
4. 实际验证后更新带截图的教程，不自动备份代码，不提交或推送 GitHub。

## Google 优先事项

- 以各网站自己的 Search Console 属性为边界，区分域名属性和网址前缀属性。
- 服务账号配置后验证 Search Console API 与属性权限，不把“取得 Indexing API 令牌”当成整个 Google 配置完成。
- 修复当前仅按 scope 缓存 Google access token 的实现，按网站、服务账号身份和 scope 隔离，避免多个网站共用错误令牌。
- 检查 HTTP 状态、robots、noindex、canonical、语言对应关系和 Sitemap 中的规范网址。
- 普通产品与 SEO 新闻以 Sitemap 提交、URL Inspection、搜索表现查询为主。
- 区分“已向 Google 提交”“Google 已读取”“已收录”，不承诺提交即收录或排名提升。
- Indexing API 仅适用于真实的 JobPosting 或 VideoObject 内的 BroadcastEvent 页面。不得给普通钻机产品和新闻伪造类型，也不能将它当作通用批量强推接口。
- 新增多网站账号隔离、错误属性、403 权限、429 配额、Sitemap 不可访问和无效 XML 的回归测试。
- Google 实际提交需要用户配置并授权属于该网站的 Search Console 服务账号；不在文档或截图里放私钥。

代码初查：当前已有 Sitemap 提交、URL Inspection、Search Analytics 和 Indexing API 入口，须优先修正已有流程，不重复建设另一套工具。

## 宝塔网站目录巡检

- 保留 FTP 发布和远程巡检，新增清楚区分的“宝塔服务器巡检”入口。
- 从当前受管网站读取 `rootPath`，显示域名、服务器和完整根目录，不接受任意系统目录输入。
- 直接读取服务器磁盘，不要求先配置 FTP 账号。
- 复用已有可疑代码规则和文件变化检测，记录新增脚本、文件篡改、上传目录 PHP、双扩展文件等。
- 支持手动扫描、停止、报告、按网站独立的定时开关与扫描间隔；默认不开启定时扫描。
- 基线只保存文件指纹，不等同于备份；由用户确认可信状态后建立，不能自动把异常状态设为可信。
- 跳过越界符号链接，限制扫描文件数、文件大小和资源用量，拒绝扫描其他网站或系统秘密文件。
- 初版只读检测，不自动删除或隔离文件。后续若加入隔离，应有人工确认、原路径记录和恢复功能。
- 规则扫描不能替代完整杀毒软件；可选补充 ClamAV 引擎，但必须显示引擎及病毒库状态，未安装时不假称完整病毒扫描。

## 官方参考

- [请求 Google 重新抓取](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Search Console Sitemap 提交 API](https://developers.google.com/webmaster-tools/v1/sitemaps/submit)
- [Indexing API 支持范围](https://developers.google.com/search/apis/indexing-api/v3/using-api)
