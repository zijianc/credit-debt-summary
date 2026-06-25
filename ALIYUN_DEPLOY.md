# 阿里云部署说明

推荐先用阿里云香港地域的 ECS 或轻量应用服务器上线测试，不需要备案；如果以后要长期稳定给更多人用，再迁移到中国大陆地域并做 ICP 备案。

## 你需要在阿里云准备

1. 开通阿里云账号并完成实名认证。
2. 购买一台服务器：
   - 地域：先选 `中国香港`。
   - 系统：Ubuntu 22.04 LTS 或 Alibaba Cloud Linux。
   - 配置：1 核 1G 可以试用，建议 2 核 2G 起。
3. 在安全组或防火墙开放端口：
   - `22`：SSH 登录。
   - `80`：HTTP 访问。
   - `443`：HTTPS 访问，配置域名证书后使用。
   - 临时测试可开放 `3000`，正式上线建议通过 Nginx 转发到 80/443。
4. 准备百炼环境变量：
   - `DASHSCOPE_API_KEY`
   - `DASHSCOPE_BASE_URL`
   - `QWEN_VISION_MODEL`
   - `QWEN_FAST_VISION_MODEL`
   - `QWEN_REASONING_MODEL`

## 服务器部署命令

以下命令适合 Ubuntu：

```bash
sudo apt update
sudo apt install -y git curl

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

git clone <你的仓库地址> credit-debt-summary
cd credit-debt-summary

cp .env.example .env
nano .env

npm ci
npm run build
PORT=3000 npm run serve
```

访问：

```text
http://服务器公网IP:3000
```

## 后台常驻运行

安装 PM2：

```bash
sudo npm install -g pm2
pm2 start "npm run serve" --name credit-debt-summary
pm2 save
pm2 startup
```

## 正式域名访问

建议用 Nginx 把 80/443 转发到本地 3000：

```bash
sudo apt install -y nginx
```

Nginx 站点示例：

```nginx
server {
  listen 80;
  server_name 你的域名;

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

如果使用中国大陆地域服务器，域名需要先完成 ICP 备案后再绑定使用。
