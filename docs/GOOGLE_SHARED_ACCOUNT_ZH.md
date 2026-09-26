# Google 服务账号共享

本地 SEO 工具的 Google 页面支持同一管理项目下多个受管网站共用服务账号。

## 使用

- 粘贴一次完整 JSON，勾选“保存为共享账号”，然后保存。
- 已配置独立账号的网站可以点击“将当前独立账号设为共享”，无需再次粘贴 JSON。
- 未单独配置的网站默认读取共享账号；已有独立账号的网站继续使用自己的账号，点击“当前网站改用共享账号”后才切换。
- 取消“保存为共享账号”再保存 JSON，会为当前网站建立独立账号。
- “停用当前网站账号”只停用该网站，不删除共享密钥，也不会自动重新继承；可点击“当前网站改用共享账号”恢复。
- 替换共享 JSON 后，使用共享账号的网站会读取新密钥；保存页面会提示其影响范围。

共享的是服务账号，Google Cloud 项目配额仍按 Google 自身规则计算，并不会因此为每个网站增加配额。网站的 Search Console 属性、Sitemap、提交记录和检查结果仍按原有站点配置隔离。每个网站都要在 Search Console 中单独授权服务账号。只有 JSON 保存成功不代表网站授权成功或已收录。

## 存储与部署

共享凭据路径：`managed-sites/_shared/google/service-account.json`。私钥只在服务器读取，不加入账号状态 API；此路径受现有 Git 忽略及普通代码发布排除规则保护。

网站原有 `googleIndexing.accountSource` 可为 `shared`、`site`、`disabled`。没有该字段时，有原有密钥的配置继续按独立账号读取，否则使用共享账号。显式切换或提升为共享时，当前站点的重复密钥清除，配额及其他网站配置不变。旧 `clientEmail` / `privateKey` 配置兼容。

共享范围是同一个管理项目实例。另一台机器或另一套独立安装不会自动获得此文件，可在其 Google 页面导入同一份 JSON。现有网站配置导出和普通项目代码同步不包含这个共享密钥文件。

2026-09-23：本地功能已启用，山博钻机现有账号已通过页面按钮设为共享；未部署线上。随后通过已连接的 Chrome，在 Search Console 的 `sc-domain:shanbo-rig.com` 属性下添加服务账号 `shanbocc@shanbo-search-console.iam.gserviceaccount.com`，权限为“完整”。本地页面点击“测试 Search Console 属性权限”返回 `siteFullUser`，属性权限正常。

## Search Console 授权图文教程

入口：本地 SEO 工具 → Google → 页面下方“服务账号授权：设置 → 用户和权限 → 添加用户”。三张截图均来自实际 Chrome 操作，点击页面中的截图可打开原图。

1. 用已验证的网站所有者账号登录 Search Console，选择目标属性，进入“设置 → 用户和权限”（繁体界面为“使用者和权限”）。
2. 点击“添加用户／新增使用者”，粘贴 JSON 的 `client_email`，选择“完整”，提交。不要填写密钥 ID 或私钥。
3. 确认列表出现服务账号及“完整”权限，再回本工具测试属性权限。只有取得令牌或保存 JSON 成功不代表网站授权成功。

`sc-domain:shanbo-rig.com` 是域名属性，可用于该域名下的各语言子域名。其他独立网站即便使用同一共享账号，也须在自己的 Search Console 属性里添加该邮箱。

截图位于 `tools/seo_publish_tool/public/tutorials/`：`google-search-console-settings-live.png`、`google-search-console-add-user-live.png`、`google-search-console-user-granted-live.png`。这些是配置示例，不表示其他网站已授权，也不表示页面已收录。

授权后针对原先失败的 `https://ar.shanbo-rig.com/` 单独调用本地 URL Inspection 接口，返回 `ok: true`，已不再报 403；Google 当前返回“Google 无法识别此网址／尚未收录”。这是索引状态，不是授权失败。教程页面刷新后，三张截图均加载成功。

## 验证

`node --test tools/seo_publish_tool/google-shared-account.test.cjs tools/seo_publish_tool/google.test.cjs`

覆盖默认共享、密钥轮换、旧账号兼容、独立账号优先、提升与切换、单站停用、无效配置、状态 API 不暴露私钥，以及原有跨站域名限制和令牌缓存隔离。17 项测试通过；本地页面点击“将当前独立账号设为共享”后状态显示“使用共享账号”。

刷新验证发现导航图标使用延迟脚本，而页面初始化可能先调用该脚本，造成状态加载中断。已将这一依赖改为先加载；刷新后确认共享账号状态正常显示。
