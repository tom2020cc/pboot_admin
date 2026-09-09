# 新电脑集中多站点安装教程

## 一、目录位置

管理项目与业务网站平级放置，不要复制进每个网站：

```text
E:\phpstudy_pro\WWW\
  pboot_admin_center\
  shanbo.c\
  site-b.com\
  site-c.com\
```

一台电脑只启动一套 `pboot_admin_center`。

## 二、第一次启动

1. 安装 Node.js LTS。
2. 把项目放到 `E:\phpstudy_pro\WWW\pboot_admin_center`。
3. 双击 `00-install.cmd`。
4. 双击 `07-start-all.cmd`。
5. 保持可见的 `Pboot Admin Backend API` 终端打开。
6. 打开 `http://localhost:5278`。
7. 没有管理员账号时使用登录页注册，或运行 `03-create-admin.cmd`。

首次启动会自动从 `backend/.env.example` 创建 `backend/.env`，不再运行独立配置向导。

## 三、添加多个网站

进入“系统管理 → 站点管理”。

网站较多时使用“扫描网站”：

1. 父目录填写 `E:\phpstudy_pro\WWW`。
2. 环境选择 `phpStudy`。
3. 点击“开始扫描”。
4. 系统只识别包含 PbootCMS 程序结构和 `data/*.db` 的目录。
5. 核对后导入选中网站。

也可以手工填写网站名称、站点标识、根目录、Pboot 数据库、线上网址和该网站的 YouTube 频道 ID。

## 四、公共配置与站点配置

整套系统共享：

- 模型 API Key。
- YouTube Data API Key。
- 管理员账号。
- 后端、前端、SEO 和 FTP 服务端口。

每个网站独立：

- PbootCMS 网站根目录和数据库。
- 线上网址和 YouTube 频道 ID。
- API、SEO、FTP、Google 配置。
- 任务队列、断点、巡检状态和备份。

每站配置保存在 `managed-sites/<站点标识>/`。模型 Key 在模型配置页填写一次即可供所有网站使用。

## 五、日常使用

以后只需双击 `07-start-all.cmd`。需要直接管理网站时也可运行 `01-sites.cmd`。

切换站点前先看页面顶部的当前站点名称。菜单、新闻、产品、单页、视频、图片和报价单操作都应跟随当前站点。

## 六、迁移与备份

迁移到新电脑时至少备份：

```text
backend/dev.sqlite 或 data/pboot-admin.sqlite
backend/.env
managed-sites/
tools/seo_publish_tool/ai.config.json
```

包含模型 Key、FTP 密码或 Google 私钥的文件必须放入加密压缩包，不要提交到 Git。

宝塔部署请继续阅读：[BAOTA_MULTI_SITE_DEPLOY_ZH.md](BAOTA_MULTI_SITE_DEPLOY_ZH.md)。
