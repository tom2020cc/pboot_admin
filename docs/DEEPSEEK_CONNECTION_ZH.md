# DeepSeek 连接测试排障

记录日期：2026-09-14。状态：已部署宝塔并完成真实连接测试。

## 本次现象

模型配置页显示 DeepSeek 已配置，但“测试连接”报错：

```text
Unexpected token '#', ... is not valid JSON
```

另一次页面观察为 `Unexpected token '<'`，生成内容中出现异常标记。不要仅凭这个错误就更换或重新填写 Key。

![模型配置页的格式错误](tutorial-assets/baota-2026-09-11/177-deepseek-json-before.jpg)

## 已核实

- 原测试代码只通过提示词要求 JSON，没有启用 DeepSeek JSON 输出模式。
- 原测试输出上限为 64 token，没有针对测试格式错误的重试。
- 项目现有本地 Key 的少量真实请求正常。当前模型列表为 `deepseek-flash` 和 `deepseek-v4-pro`；本次实测旧名 `deepseek-chat` 仍返回成功，并由 `deepseek-flash` 响应。
- 官方曾公告旧名停止使用，但本次实测仍兼容。因此不能把本次格式错误直接断言为旧模型已完全不可用。本轮保留已有模型选择值，没有迁移文章、产品或任务数据。

## 代码修复

1. 仅在连接探测中启用 `response_format: { type: "json_object" }`，并关闭思考输出。
2. 首次探测最大输出 256 token；格式异常自动重试一次，第二次最多 512 token。
3. 单次请求最多 30 秒，两次探测合计最多约 45 秒；计时包含读取响应正文。
4. 分别识别接口外层 JSON 错误、模型内容格式错误、输出截断。
5. 401、402、429 等 HTTP 错误不会被格式重试掩盖。
6. 两次仍异常时保留失败状态，不将任意文本当成成功，也不删除非法字符来伪造合法 JSON。
7. 原 SEO 批量任务需要 JSON 数组，因此不对这些请求强制使用对象模式。

## 验证

```sh
node --test tools/seo_publish_tool/ai-connection.test.cjs tools/seo_publish_tool/inspection.test.js
```

本轮结果：29 项通过；本地代码连续 3 次真实连接测试通过。宝塔更新后实际探测 605ms、一次成功；浏览器模型配置页再次测试显示约 0.3 秒，连接及 JSON 校验正常。没有生成文章、发布内容或导入产品。

## 宝塔更新实录

1. 宝塔“文件”中上传本轮增量发布包到 `/www/backup`。此目录在当前部署流程中也作为临时发布目录使用，发布包不是旧代码备份。
2. 校验压缩包 SHA-256，解压到独立的 `/www/backup/pboot-pdf-stage-*` 暂存目录。
3. 使用 Node 22 执行包内 `deploy/install-seo-connection-update.cjs`，传入暂存目录。
4. 安装脚本先核对线上源文件指纹，再检查每个网站没有运行中的 SEO 任务。
5. 仅更新本轮四个指定文件，运行测试，仅重启 `pboot-seo-tool`。
6. 安装脚本用服务器已保存的后台账号验证连接；日志不输出密码或 Key。
7. 刷新模型配置页，点击 DeepSeek“测试连接”，应显示“连接及 JSON 校验正常”。保存成功截图，再补充到部署教程。

本次 DeepSeek 增量更新没有 `--backup` 操作，不上传 GitHub，不重启 API、FTP 或 SEO 写作 worker。后续 Google/巡检更新另行重启对应工具。

![宝塔更新验证](tutorial-assets/baota-2026-09-11/178-deepseek-release.jpg)

![线上连接及 JSON 校验通过](tutorial-assets/baota-2026-09-11/179-deepseek-json-success.jpg)

### 宝塔终端输入不完整时

长命令逐字输入可能被浏览器终端截断。不要不断追加命令；关闭当前终端视图并重新连接，确认出现干净的 shell 提示符。将已审核的 LF 脚本与发布包通过宝塔“文件 → 上传”一起上传，再输入短命令 `bash /www/backup/run-deepseek-release.sh`。发布脚本包含 SHA-256 校验，必须看到完成标记和返回的提示符，不能仅以“按下回车”判断成功。已完成的发布脚本不要重复执行。

## 官方依据

- [DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)
- [当前模型列表和计费说明](https://api-docs.deepseek.com/quick_start/pricing/)
- [旧模型名称公告](https://api-docs.deepseek.com/news/news260424/)
