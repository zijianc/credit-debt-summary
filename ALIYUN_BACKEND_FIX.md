# 阿里云前端访问不到后端排查与修复

现象：网页能打开，但点击“开始统计欠款”时报错；或者公网访问 `http://39.105.223.121` / `http://39.105.223.121:3000` 超时。

本项目的正确结构是：

- Node 服务监听本机 `3000` 端口。
- Node 服务同时提供前端页面和 `/api/analyze-report`。
- Nginx 监听公网 `80`，把所有请求转发到 `127.0.0.1:3000`。
- 前端代码使用相对路径 `/api/analyze-report`，不需要单独配置后端域名。

## 1. 在服务器上执行诊断

登录服务器：

```bash
ssh root@39.105.223.121
```

执行：

```bash
cd /opt/credit-debt-summary

pwd
git status --short
node -v
npm -v

pm2 status || true
ss -lntp | grep -E ':80|:3000' || true
systemctl status nginx --no-pager || true

curl -I http://127.0.0.1:3000 || true
curl -sS -X POST http://127.0.0.1:3000/api/analyze-report \
  -H 'Content-Type: application/json' \
  -d '{}' || true

curl -I http://127.0.0.1 || true
curl -sS -X POST http://127.0.0.1/api/analyze-report \
  -H 'Content-Type: application/json' \
  -d '{}' || true
```

正常结果应该包括：

- `ss -lntp` 能看到 `:3000` 和 `:80`。
- `curl -I http://127.0.0.1:3000` 返回 `HTTP/1.1 200 OK`。
- `curl -X POST http://127.0.0.1:3000/api/analyze-report -d '{}'` 返回 `{"error":"Missing report text or images."}`。
- `curl -I http://127.0.0.1` 返回 `HTTP/1.1 200 OK`。

## 2. 如果 3000 端口没有监听

说明 Node 服务没启动。

执行：

```bash
cd /opt/credit-debt-summary

npm ci
npm run build

npm install -g pm2
pm2 delete credit-debt-summary || true
PORT=3000 pm2 start "npm run serve" --name credit-debt-summary
pm2 save

pm2 status
pm2 logs credit-debt-summary --lines 80
```

再测：

```bash
curl -I http://127.0.0.1:3000
curl -sS -X POST http://127.0.0.1:3000/api/analyze-report \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## 3. 如果 3000 正常，但 80 不正常

说明 Nginx 没配好或没启动。

写入 Nginx 配置：

```bash
cat >/etc/nginx/sites-available/credit-debt-summary <<'EOF'
server {
  listen 80;
  server_name 39.105.223.121;

  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

ln -sf /etc/nginx/sites-available/credit-debt-summary /etc/nginx/sites-enabled/credit-debt-summary
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl status nginx --no-pager
```

再测：

```bash
curl -I http://127.0.0.1
curl -sS -X POST http://127.0.0.1/api/analyze-report \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## 4. 如果本机 127.0.0.1 正常，但公网 IP 超时

说明阿里云安全组或系统防火墙没放行。

在服务器执行：

```bash
ufw status || true
iptables -S | head -80 || true
```

如果启用了 UFW：

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw reload
```

同时在阿里云控制台检查安全组入方向规则，至少需要：

| 协议 | 端口 | 授权对象 |
| --- | --- | --- |
| TCP | 22 | 你的 IP 或 `0.0.0.0/0` |
| TCP | 80 | `0.0.0.0/0` |
| TCP | 443 | `0.0.0.0/0` |
| TCP | 3000 | `0.0.0.0/0`，仅临时测试需要 |

正式使用 Nginx 后，公网只需要开放 `80/443`，`3000` 可以关闭。

## 5. 如果前端能打开，但点击按钮请求失败

打开浏览器开发者工具或手机远程调试，看请求地址。

正确请求应该是：

```text
POST http://39.105.223.121/api/analyze-report
```

如果请求的是：

```text
http://localhost:3000/api/analyze-report
```

或者其他本机地址，说明前端构建使用了错误的后端地址。本项目当前代码不会这样做，因为它固定请求相对路径：

```ts
fetch('/api/analyze-report', ...)
```

这种情况下重新拉取最新代码并构建：

```bash
cd /opt/credit-debt-summary
git pull
npm ci
npm run build
pm2 restart credit-debt-summary
```

## 6. 如果接口返回 AI 分析失败

这说明前端已经连到后端了，问题变成后端调用百炼失败。

检查 `.env`：

```bash
cd /opt/credit-debt-summary
cat .env
pm2 logs credit-debt-summary --lines 120
```

至少需要：

```bash
DASHSCOPE_API_KEY=真实Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_VISION_MODEL=qwen3.6-plus
QWEN_FAST_VISION_MODEL=qwen3.6-plus
QWEN_REASONING_MODEL=qwen3.6-plus
```

修改 `.env` 后重启：

```bash
pm2 restart credit-debt-summary
```

## 7. 一键修复命令

如果不想逐步排查，可以在服务器上执行：

```bash
cd /opt/credit-debt-summary
git pull
npm ci
npm run build

npm install -g pm2
pm2 delete credit-debt-summary || true
PORT=3000 pm2 start "npm run serve" --name credit-debt-summary
pm2 save

cat >/etc/nginx/sites-available/credit-debt-summary <<'EOF'
server {
  listen 80;
  server_name 39.105.223.121;

  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF

ln -sf /etc/nginx/sites-available/credit-debt-summary /etc/nginx/sites-enabled/credit-debt-summary
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

curl -I http://127.0.0.1
curl -sS -X POST http://127.0.0.1/api/analyze-report \
  -H 'Content-Type: application/json' \
  -d '{}'
```
