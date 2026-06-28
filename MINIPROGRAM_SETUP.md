# 微信小程序第一版接入说明

## 当前状态

- 小程序代码目录：`miniprogram/`
- AppID 已写入：`miniprogram/project.config.json`
- 后端接口域名：`https://chenzijianhandsome.xyz/api/analyze-report`
- AppSecret 和上传密钥不要写入仓库。

## 本地预览

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择本仓库里的 `miniprogram/`。
4. AppID 使用当前小程序 AppID。
5. 如果域名备案、HTTPS、微信合法域名还没完成，开发者工具里临时勾选：
   - 不校验合法域名、web-view 域名、TLS 版本以及 HTTPS 证书

## 上线前必须完成

1. ICP 备案审核通过。
2. 给 `chenzijianhandsome.xyz` 配置 HTTPS 证书。
3. Nginx 支持 `https://chenzijianhandsome.xyz/api/analyze-report` 转发到 Node 后端。
4. 微信公众平台后台配置服务器域名：
   - request 合法域名：`https://chenzijianhandsome.xyz`
   - uploadFile 合法域名：`https://chenzijianhandsome.xyz`

## 功能

- 拍照上传征信图片
- 从相册选择多张图片
- 从微信聊天文件选择 PDF
- 精准/快速两种模式
- 展示欠款合计、明细、可信度、风险提醒

## PDF 说明

第一版支持有文字层的 PDF。扫描版 PDF 如果后端无法提取文字，会提示改用拍照或图片上传。

## 密钥安全

小程序前端不需要 AppSecret，也不需要百炼 API Key。上线前建议在微信公众平台重置已经暴露过的 AppSecret 和代码上传密钥，然后只保存在本机或 CI 的安全环境变量里。
