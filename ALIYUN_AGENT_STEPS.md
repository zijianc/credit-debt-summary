# 阿里云服务器 Agent 部署步骤

目标：在阿里云 Ubuntu 22.04 ECS 上部署“征信欠款统计”手机 H5 应用。应用包含前端页面和后端 `/api/analyze-report` 接口，后端会调用阿里云百炼 / DashScope 的 Qwen 模型。

## 服务器信息

- 公网 IP：`39.105.223.121`
- 内网 IP：`172.27.249.59`
- 操作系统：`Ubuntu 22.04 64位`
- 规格：`2 vCPU / 2 GiB`
- 公网带宽：`3 Mbps`

## 部署前检查

1. 在阿里云安全组中开放端口：
   - `22`：SSH 登录
   - `80`：HTTP 访问
   - `443`：HTTPS 访问
   - `3000`：临时测试端口，正式上线后可以关闭
2. 准备 GitHub 仓库地址：
   - 将下面命令里的 `<GITHUB_REPO_URL>` 替换为实际仓库地址。
3. 准备百炼环境变量，不要写进 GitHub：
   - `DASHSCOPE_API_KEY`
   - `DASHSCOPE_BASE_URL`
   - `QWEN_VISION_MODEL`
   - `QWEN_FAST_VISION_MODEL`
   - `QWEN_REASONING_MODEL`

## 1. 登录服务器

```bash
ssh root@39.105.223.121
```

如果不是 root 用户，请用实际用户名登录，并在需要时加 `sudo`。

## 2. 安装基础软件

```bash
apt update
apt install -y git curl nginx

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

node -v
npm -v
```

要求 Node.js 版本为 `24.x`。如果安装的是其他版本，也可以使用 `nvm` 安装 Node 24。

## 3. 拉取代码

```bash
cd /opt
git clone <GITHUB_REPO_URL> credit-debt-summary
cd /opt/credit-debt-summary
```

如果目录已经存在：

```bash
cd /opt/credit-debt-summary
git pull
```

## 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

`.env` 示例：

```bash
DASHSCOPE_API_KEY=替换成真实Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_VISION_MODEL=qwen3.7-plus
QWEN_FAST_VISION_MODEL=qwen3.7-plus
QWEN_REASONING_MODEL=qwen3.7-plus
```

注意：

- `.env` 只放在服务器本地。
- 不要提交 `.env` 到 GitHub。
- 如果使用百炼国际站或其他地域，请按实际控制台文档调整 `DASHSCOPE_BASE_URL`。

## 5. 安装依赖并构建

```bash
npm ci
npm run build
```

构建成功后会生成 `dist/` 目录。

## 6. 临时启动测试

```bash
PORT=3000 npm run serve
```

浏览器访问：

```text
http://39.105.223.121:3000
```

测试接口：

```bash
curl -sS -X POST http://127.0.0.1:3000/api/analyze-report \
  -H 'Content-Type: application/json' \
  -d '{}'
```

如果返回：

```json
{"error":"Missing report text or images."}
```

说明后端接口已正常工作。按 `Ctrl+C` 停止临时服务。

## 7. 用 PM2 常驻运行

```bash
npm install -g pm2

cd /opt/credit-debt-summary
PORT=3000 pm2 start "npm run serve" --name credit-debt-summary
pm2 save
pm2 startup
```

执行 `pm2 startup` 后，终端会输出一条 `sudo env PATH=... pm2 startup ...` 命令。复制并执行它。

查看状态：

```bash
pm2 status
pm2 logs credit-debt-summary
```

## 8. 配置 Nginx

创建站点配置：

```bash
nano /etc/nginx/sites-available/credit-debt-summary
```

写入：

```nginx
server {
  listen 80;
  server_name 39.105.223.121;

  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

启用配置：

```bash
ln -sf /etc/nginx/sites-available/credit-debt-summary /etc/nginx/sites-enabled/credit-debt-summary
nginx -t
systemctl reload nginx
```

访问：

```text
http://39.105.223.121
```

## 9. 更新代码

以后更新版本：

```bash
cd /opt/credit-debt-summary
git pull
npm ci
npm run build
pm2 restart credit-debt-summary
```

## 10. 域名和 HTTPS

当前可以先用 IP 访问。如果后续绑定域名：

1. 将域名解析到 `39.105.223.121`。
2. 如果服务器在中国大陆地域，域名需要完成 ICP 备案后才能正常提供网站服务。
3. 安装 HTTPS 证书后，将 Nginx 从 `80` 升级为 `443`。

使用 Let's Encrypt 的命令示例：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名
```

如果暂时没有域名，先不要配置 HTTPS，直接用 `http://39.105.223.121` 测试。

## 11. 常见问题

### 打不开网页

检查：

```bash
pm2 status
systemctl status nginx
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1
```

同时确认阿里云安全组已开放 `80` 和 `3000`。

### AI 分析失败

检查：

```bash
cd /opt/credit-debt-summary
cat .env
pm2 logs credit-debt-summary
```

重点确认 `DASHSCOPE_API_KEY` 是否存在、模型名称是否正确、服务器能否访问 DashScope 接口。

### 上传多张图片超时

当前应用最多支持 6 张图片。3 Mbps 带宽较小，建议用户每次上传 1-3 张清晰照片，尽量裁掉无关背景。
