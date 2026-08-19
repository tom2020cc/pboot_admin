# 新电脑、新网站部署教程

本教程用于把整套 PbootCMS 管理工具迁移到另一台 Windows 电脑，或连接一个新的 PbootCMS 网站。

## 最简单的三步

1. 安装 Node.js LTS。安装时保持 `Add to PATH`（添加到环境变量）选中。
2. 把整个 `pboot_admin` 文件夹放到目标 PbootCMS 网站根目录，然后依次双击 `00-install.cmd`、`01-config.cmd`。
3. 在配置向导中确认网站目录、数据库和端口，保存后双击 `02-start.cmd`。

推荐目录结构：

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

每个网站复制一套独立的 `pboot_admin`。不要让多个网站共用同一个管理项目。

## 第一次安装

### 1. 安装 Node.js

从 Node.js 官方网站安装当前 LTS 版本。安装完成后重新打开命令行，执行：

```powershell
node -v
```

能显示版本号即可。项目的 `00-install.cmd` 会自动准备 pnpm，不需要手工安装项目依赖。

### 2. 安装项目依赖

双击 `00-install.cmd`。它会依次检查 Node.js、pnpm，并安装：

- NestJS 后端依赖
- Vue3 前端依赖
- SEO 检查工具依赖
- FTP 发布工具依赖

看到 `All dependencies are installed` 后再关闭窗口。黄色的 deprecated 警告通常不是安装失败；只有红色 `ERROR` 才需要处理。

### 3. 打开配置向导

双击 `01-config.cmd`，浏览器会打开本网站独立的配置页。逐项确认：

- **网站根目录**：当前 PbootCMS 网站目录，不是 `pboot_admin` 目录。
- **SQLite 数据库**：必须位于当前网站的 `data` 目录。
- **真实线上地址**：用于 SEO、sitemap、IndexNow，不要填写 localhost。
- **本地测试地址**：仅用于本地预览，例如 `http://example.local`。
- **端口**：后端、前端、SEO、FTP 四个端口不能重复。
- **请求大小上限**：产品正文较大时可设为 `20mb`，一般 `10mb` 足够。
- **API Key / FTP 密码**：留空会保留原值，不会清除已保存的密钥。

点击“一键自检”。全部显示“正常”后保存。

### 4. 启动管理项目

双击 `02-start.cmd`。脚本会分别启动后端和前端，并打开管理页面。两个命令行窗口需要保持打开。

首次没有登录账号时，双击 `03-create-admin.cmd` 创建管理员。

## 连接新网站

1. 先确认新网站可以在 phpStudy 中正常打开。
2. 把一份干净的 `pboot_admin` 复制到新网站根目录。
3. 不要从旧项目复制 `backend/.env`、`backend/dev.sqlite`、SEO/FTP 私密配置或数据库备份。
4. 运行 `00-install.cmd` 和 `01-config.cmd`。
5. 配置向导会自动寻找当前网站 `data` 目录中最近更新的 `.db` 文件。
6. 保存配置并运行 `02-start.cmd`。
7. 在管理后台先核对栏目语言和数量，再按“栏目、新闻、单页、视频、产品”的顺序从 PB 获取数据。

如果网站只有两种语言，系统会以该网站数据库中真实存在的语言为准，不要求固定七种语言。

## 一台电脑运行多个网站

每个网站必须使用不同端口。例如：

| 项目 | 后端 | 前端 | SEO | FTP | 配置向导 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 网站 A | 5000 | 5173 | 5188 | 5189 | 5190 |
| 网站 B | 5100 | 5273 | 5288 | 5289 | 5290 |

配置向导会检查同一项目内的端口冲突。多个网站之间仍需自行分配不同端口。

## 独立工具

- `05-start-seo-tool.cmd`：启动当前网站的 SEO 检查、sitemap、IndexNow 和 Google Search Console 工具。
- `06-start-ftp-tool.cmd`：启动当前网站的 FTP 上传工具。

工具读取的都是当前 `pboot_admin` 内的独立配置，不应该跨网站共用。

## 数据库说明

- PbootCMS 原数据库：当前网站 `data\*.db`。
- 管理后台数据库：`backend\dev.sqlite`，首次运行自动创建。
- 后端数据库备份：默认在 `backups\backend_database`。
- 同步或覆盖 PB 数据前，必须再次核对页面顶部显示的网站根目录和数据库路径。

迁移到新网站时，建议让管理后台数据库重新创建，然后从新网站 PB 数据库获取内容。只有明确需要保留管理后台本地编辑记录时，才复制旧的 `dev.sqlite`。

## 常见问题

### `pnpm` 检查长时间不动

先等 1 至 3 分钟。仍无进展时关闭窗口，确认网络正常，再重新运行 `00-install.cmd`。也可在项目根目录执行：

```powershell
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

### `EADDRINUSE` 或端口被占用

先双击 `04-stop-ports.cmd`，再启动。若同一电脑运行多个网站，请通过 `01-config.cmd` 给当前网站换一组端口。

### 页面显示空数据或提示数据库异常

立即停止同步。运行 `01-config.cmd`，检查网站根目录和 PB 数据库是否属于当前网站。不要为了通过保护检查而随意选择其他网站数据库。

### `request entity too large`

运行 `01-config.cmd`，把“接口请求大小上限”从 `10mb` 调整为 `20mb`，保存后重启后端。

### 图片不显示

确认配置中的本地测试地址和网站根目录正确，并检查图片文件是否真实存在于当前网站。正文中的 `/static/...` 路径依赖本地网站能正常访问。

### 配置向导打不开

确认没有另一个配置向导占用同一端口。`01-config.cmd` 会尝试寻找空闲端口；仍失败时先关闭旧窗口，或执行 `04-stop-ports.cmd`。

## 安全注意事项

- 不要把 API Key、FTP 密码、服务账号 JSON 发给其他人。
- 不要把整个 `pboot_admin` 上传到公开网站目录或 FTP 空间。
- 对外发布只上传网站需要的数据库、图片和 SEO 文件。
- 同步、批量翻译、批量删除前先备份数据库。
- 配置向导不会把已保存密钥回显到浏览器；输入框留空表示保留原值。

## 日常使用

以后通常只需双击 `02-start.cmd`。只有更换网站数据库、域名、端口、AI Key 或 FTP 配置时，才重新运行 `01-config.cmd`。
