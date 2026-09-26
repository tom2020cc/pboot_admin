# Google / Bing 共享账号同步

## 为什么代码和站点配置同步后仍显示未配置

共享账号独立保存在管理项目的 `managed-sites/_shared/`，不属于某个站点。原先代码同步排除运行凭据，站点配置同步只遍历站点目录，项目配置同步只支持图片和模型密钥，因此漏掉了共享搜索账号。

## 使用方法

网站发布 → 代码与配置 → **② 项目配置同步**，勾选 **Google / Bing 共享账号** → 查看待上传 → 同步项目配置。首次只需传两份文件，后续按内容变化增量同步。

- `managed-sites/_shared/google/service-account.json`
- `managed-sites/_shared/bing/account.json`

该选项默认不勾选，覆盖线上同名共享账号前可以查看计划；同一线上管理项目中使用共享账号的网站都会使用同步后的账号。站点自己的域名、Search Console 属性和账号来源仍由站点 SEO 配置管理；专用账号或已停用账号不会自动切换。

只同步共享账号时刷新线上 SEO 页面即可读取，不需要重启、重新构建或同步数据库。本地缺失的账号保留线上文件，损坏的文件会阻止同步。同步采用精确文件名单，不遍历 `_shared` 中其他文件，凭据内容不作路径替换，不在预览和日志中输出。

## 2026-09-23 验证

- 同步引擎 16 项测试通过，覆盖选择范围、精确上传、凭据原样保留、增量变更、空配置保留及错误脱敏。
- 使用本地发布界面实际上传两份共享账号文件，2 个成功。
- 线上 Google 页面显示共享服务账号，Search Console 属性权限返回 `siteFullUser`。
- 线上 Bing 页面显示共享账号，权限测试返回“账号连接成功，当前网站已验证”。
- 本次没有同步数据库、站点配置或重新部署管理项目代码。
- 本地 5389 服务重启命令被自动审批拒绝，新功能使用临时 5399 发布服务完成验证；原 5389 服务需要重启后才能加载新的同步引擎。

![线上 Google 共享账号](../tools/seo_publish_tool/public/tutorials/google-online-shared-account-live.png)

![线上 Bing 权限通过](../tools/seo_publish_tool/public/tutorials/bing-online-shared-account-live.png)
