# 征信欠款统计

一个浏览器端运行的征信报告欠款统计 MVP。用户上传 PDF 或粘贴报告文本后，系统只展示识别到的欠款汇总和明细，不上传、不保存原始征信报告。

## 本地运行

```bash
npm install
npm run dev
```

如果要测试图片 OCR 和 AI 复核接口，需要使用 Netlify Functions：

```bash
cp .env.example .env
# 填入 DASHSCOPE_API_KEY
npx netlify dev
```

## 构建

```bash
npm run build
```

构建产物在 `dist/`。如果部署到阿里云服务器，可以使用 `npm run serve` 同时提供前端页面和 `/api/analyze-report` 接口。

## 手机 H5 第一版上线

推荐先部署成手机网页，家人用微信打开链接即可使用。阿里云部署步骤见 [ALIYUN_DEPLOY.md](./ALIYUN_DEPLOY.md)。

1. 把代码推到 GitHub。
2. 在 Netlify 新建站点，连接这个仓库。
3. 构建命令填 `npm run build`，发布目录填 `dist`。
4. 在 Netlify 的环境变量里配置：
   - `DASHSCOPE_API_KEY`
   - `DASHSCOPE_BASE_URL`
   - `QWEN_VISION_MODEL`
   - `QWEN_FAST_VISION_MODEL`
   - `QWEN_REASONING_MODEL`
5. 部署完成后，把 HTTPS 网址发到微信，或用任意二维码工具生成二维码。

手机使用流程：打开网页，点“拍照或选择征信照片”，可一次选择多张，也可以追加上传；确认方向后点“开始统计欠款”。

## 解析范围

- 支持文本型 PDF 和手动粘贴文本。
- 支持图片上传，图片会通过后端调用 Qwen 视觉模型识别。
- 支持对 PDF、图片或粘贴文本进行 AI 复核；快速模式默认用 `qwen3.6-plus` 直接读图并输出结构化欠款，精准模式默认用 `qwen3.6-plus` 做视觉识别和欠款总结。
- 会识别贷款余额、未还本金、信用卡已用额度、透支余额、逾期金额等欠款语义。
- 会排除授信额度、合同金额、发放金额、月还款额等非欠款字段。
- 扫描件 PDF 会在浏览器中渲染前几页为图片，再交给后端 OCR。

## 百炼 / DashScope 配置

后端函数读取以下环境变量，不能把 Key 写进前端代码：

- `DASHSCOPE_API_KEY`：百炼 API Key。
- `DASHSCOPE_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `QWEN_VISION_MODEL`：默认 `qwen3.6-plus`。如果需要对比，也可以改成 `qwen3-vl-plus` 或 `qwen-vl-ocr`。
- `QWEN_FAST_VISION_MODEL`：快速模式默认 `qwen3.6-plus`。
- `QWEN_REASONING_MODEL`：默认 `qwen3.6-plus`，需要对比时可改成其他兼容模型。

所有模型调用都会传入 `enable_thinking: false`，关闭深度思考以降低延迟。

部署到 Netlify 后，在站点环境变量里配置这些值。快速模式会把图片直接交给 `QWEN_FAST_VISION_MODEL` 输出结构化欠款 JSON；精准模式会先调用视觉模型抽取文本，再调用总结模型输出结构化欠款 JSON。

## 微信小程序方向

当前核心解析逻辑在 `src/lib/debtParser.ts`，后续可以抽成共享包给微信小程序复用。小程序端通常需要：

- 使用 `wx.chooseMessageFile` 上传 PDF 或图片。
- 文本型 PDF 可走云函数解析；图片/扫描件走 OCR。
- 原文处理后立即删除，只保存欠款汇总结果。
