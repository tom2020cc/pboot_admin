# PbootCMS FTP 上传工具

这个工具独立于 Vue3/NestJS 前后端，只负责把当前本地 PbootCMS 网站里的数据和图片上传到线上 FTP 空间。

默认上传：

- `data/*.db`
- `static/`
- `uploads/`
- `sitemap.xml`
- `robots.txt`
- 根目录 `*.txt`，用于 IndexNow key

默认会排除：

- `data/*.before_*.db`
- `data/*.bad_*.db`
- `data/*.old*.db`
- `data/*.bak*.db`
- 所有 `.zip`、`.rar`、`.7z`

默认不上传：

- PbootCMS 程序文件
- 模板文件
- 前后端项目
- 日志、压缩包、缓存

## 第一次使用

1. 双击 `安装依赖.bat`。
2. 双击 `启动FTP网页工具.bat`。
3. 浏览器打开 `http://localhost:5189`。
4. 在页面里填写 FTP 信息并保存。
5. 先点“刷新上传计划”，确认文件数量和路径没问题。
6. 点“测试 FTP 连接”。
7. 再点“开始上传”。

命令行方式仍然保留：

- `先演练不上传.bat`
- `上传到FTP.bat`

## 配置说明

```json
{
  "host": "你的FTP地址",
  "port": 21,
  "user": "FTP用户名",
  "password": "FTP密码",
  "secure": false,
  "remoteRoot": "/",
  "localRoot": ".."
}
```

`remoteRoot` 是线上空间的网站根目录。有些空间是 `/`，有些是 `/wwwroot`、`/public_html`、`/htdocs`。

如果不确定，先用 FTP 软件看一下远程目录结构：能看到 `data`、`static`、`template` 等目录的那个位置，就是网站根目录。

如果页面提示 `550 Failed to change directory`，通常是远程根目录不对。虚拟主机常见填法：

- `/`：登录后就是网站根目录。
- `wwwroot`
- `public_html`
- `htdocs`

新版网页工具会尽量使用相对路径上传，兼容不允许 `/data` 这种绝对路径的 FTP 空间。

## 两个重要建议

1. 先在本地 phpStudy 网站里确认后台、前台都正常，再上传。
2. 上传前最好先备份线上空间的数据库文件，尤其是 `data/*.db`。

## 上传速度

数据库文件每次都会上传。图片默认开启 `skipSameSizeAssets`，如果线上同路径文件大小一致，就自动跳过，只上传新增或变化的图片。

如果你想强制全量上传图片，把 `ftp.config.json` 里的这一项改成：

```json
"skipSameSizeAssets": false
```

## 安全提醒

这里会保存 FTP 密码，所以不要把 `ftp_publish_tool` 暴露给外部访问。

我已经加了 `.htaccess` 和 `web.config` 来尽量禁止 Web 访问，但如果你的线上服务器是 Nginx，可能不会读取这两个文件。最稳的方式是：本地使用这个工具，不要把 `ftp_publish_tool` 上传到线上空间。
