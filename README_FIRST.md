# Pboot Admin 可迁移最新版

## 新电脑最快启动

1. 安装 Node.js LTS。
2. 双击 `00-install.cmd`。
3. 双击 `01-config.cmd`，确认当前网站根目录和 `data` 目录里的数据库，点击“一键自检”并保存。
4. 双击 `02-start.cmd`。

完整图文式文字教程见：[docs/NEW_PC_SETUP_ZH.md](docs/NEW_PC_SETUP_ZH.md)。

此目录是独立部署包。每个 PbootCMS 网站都必须放置自己的一份，配置、后台数据库、备份、SEO 和 FTP 信息互不影响。

## 一、放置位置

把整个目录复制到目标 PbootCMS 网站根目录，并建议重命名为 `pboot_admin`。

正确结构示例：

```text
D:\phpstudy_pro\WWW\example.com\
  admin.php
  data\
  static\
  pboot_admin\
    backend\
    frontend\
    tools\
    00-install.cmd
    01-config.cmd
    02-start.cmd
```

不要把同一份 `pboot_admin` 跨多个网站共用，也不要在配置向导里选择其他网站的数据库。

## 二、新电脑第一次运行

1. 安装 Node.js LTS，安装时保持“添加到 PATH”选中。
2. 双击 `00-install.cmd`，脚本会安装 pnpm 和前后端、SEO、FTP 工具依赖。
3. 双击 `01-config.cmd`。
4. 浏览器打开配置向导后，检查“网站根目录”和“PbootCMS 数据库”。放置位置正确时会自动识别上一级网站及其 `data` 目录中的数据库。
5. 填写本地测试地址、真实线上地址、端口。AI Key 和 FTP 可以稍后再填。
6. 保存配置。
7. 双击 `02-start.cmd`。后端和前端窗口都要保持打开，浏览器会自动打开管理后台。
8. 第一次没有管理员时，双击 `03-create-admin.cmd`。

## 三、数据库说明

- PbootCMS 原数据库：仍然位于目标网站自己的 `data\*.db` 中，配置向导只连接当前网站的数据库。
- 本管理项目数据库：`backend\dev.sqlite`，首次启动后端时自动创建，不需要从旧网站复制。
- 本包未携带旧网站的 `dev.sqlite`、缓存数据、备份、上传文件、域名、API Key 或 FTP 密码。
- 第一次连接新网站后，按栏目、新闻、单页、视频、产品的顺序检查并获取 PB 数据。
- 覆盖同步前先核对页面显示的网站根目录和数据库路径，避免选错站点。

## 四、常用脚本

- `00-install.cmd`：使用 pnpm 安装全部依赖。
- `01-config.cmd`：打开本站独立配置向导。
- `02-start.cmd`：一键启动 NestJS 后端和 Vue3 前端。
- `03-create-admin.cmd`：创建登录管理员。
- `04-stop-ports.cmd`：关闭本项目配置的服务端口。
- `05-start-seo-tool.cmd`：启动本站 SEO 工具。
- `06-start-ftp-tool.cmd`：启动本站 FTP 上传工具。

如果同一台电脑同时运行多个网站，请在各自的配置向导中设置不同的前后端端口。

## 五、日常使用

以后只需要双击 `02-start.cmd`。更换数据库、域名、端口、AI 或 FTP 设置时，再运行 `01-config.cmd`。
