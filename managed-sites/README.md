# 多站点配置目录

系统会按“站点标识”自动创建独立目录，不要手工复制另一个站点的敏感配置。

```text
managed-sites/
  example-site/
    site.json       # 网站路径、数据库、网址、YouTube 频道等站点档案
    api/            # 该网站的 Webhook、外部接口参数和后台上传文件
      uploads/      # 仅属于该网站的图片等上传内容
    seo/            # seo.config.json 与搜索引擎快照
    ftp/            # ftp.config.json、可信基线、巡检历史和巡检断点
    google/         # Search Console 诊断与 Indexing API 续传状态
    state/          # AI 修复等后台任务断点
    backups/        # 该网站的配置备份
  _archive/         # 删除或改名后的站点配置归档
```

后端接口源码和四个服务端口只保留一套，请求通过 `X-Pboot-Site-Id` 选择网站；菜单、新闻、产品、单页、视频和报价单在中心数据库中通过 `siteId` 隔离，不复制一套后端程序。

模型 API Key 与 YouTube Data API Key 属于整套管理系统的公共配置，所有网站共用。YouTube 频道 ID、后台上传文件、Pboot 数据库、SEO/Google/FTP 凭据和任务断点属于单站配置。未填频道 ID 的网站不会回退使用默认站频道。站点目录可能包含密码和服务账号私钥，默认已被 `.gitignore` 排除；迁移时应使用配置备份或加密压缩包。

从旧版升级时，历史内容只会在后端启动时归入默认站点。新建站点不会复制默认站点的 FTP 密码、Google 私钥、IndexNow Key 或百度 Token。
