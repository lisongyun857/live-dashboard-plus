# AI 部署说明 · 后端 + 前端

> 这份文档写给**执行部署的 AI 代理**（或照着敲命令的人）。目标是：把本仓库的**后端**（Node.js，零依赖）部署到一台 Linux 服务器并常驻，把**前端**（Vue 3 构建出的纯静态文件）部署到另一个域名。
>
> 全文按阶段顺序执行，**每个阶段结尾都有"验证"动作**。验证不通过就不要进入下一阶段。
> 凡是 `<尖括号>` 都是占位符，执行前必须先替换成实际值（见【变量表】）。

---

## 0. 部署模型与约束

```
用户浏览器 ──HTTPS──▶ <WEB_DOMAIN>     前端静态站点（Nginx 托管 dist/）
    │
    └──跨域 HTTPS──▶ <API_DOMAIN>      后端 Node.js（127.0.0.1:3000，Nginx 反代）
                            ▲
被监控设备（Windows agent / 手机 MacroDroid）──直接 POST──┘
```

**必须遵守**

1. 前后端是**两个独立域名**，不是同域名分流。前端所有 `/api/*` 请求指向 `<API_DOMAIN>`。
2. 两个域名**都必须是 HTTPS**。HTTPS 页面请求 HTTP 接口会被浏览器按混合内容直接拦截。
3. 后端目录里**不能包含** `config.json` 和 `data/`（本机私有数据）；服务器上首次启动会自己生成。
4. 不要提交、不要打印到日志：`config.json` 里的 `admin_password`、各设备的 `token`。
5. 不要修改业务代码来"修部署问题"。部署问题只在 Nginx / 环境变量 / 目录权限层面解决。

**变量表**（执行前全部替换）

| 占位符 | 含义 | 示例 |
|---|---|---|
| `<API_DOMAIN>` | 后端 API 域名 | `api.example.com` |
| `<WEB_DOMAIN>` | 前端站点域名 | `web.example.com` |
| `<BACKEND_HOST>` | 后端服务器 SSH 地址 | `root@1.2.3.4` |
| `<WEB_HOST>` | 前端服务器 SSH 地址（与后端同机时相同） | `root@1.2.3.4` |
| `<API_DIR>` | 后端部署目录 | `/opt/live-dashboard` |
| `<WEB_DIR>` | 前端静态目录 | `/var/www/live-dashboard` |
| `<PORT>` | 后端监听端口（默认 3000，取自 config.json） | `3000` |

**产物来源（本机执行，不是服务器）**

| 产物 | 位置 | 说明 |
|---|---|---|
| 后端 | `backend/` | `server.js`、`lib/`、`agent/`、`package.json`、`start.cmd`、`config.example.json` |
| 前端 | `frontend/dist/` | `npm run build` 产物，只有静态文件 |
| 客户机 agent | `backend/agent/` | 给被监控的 Windows 电脑用，**不是**服务器用 |

---

## 阶段 1 · 本地构建前端（最关键的一步）

前端构建时会把 API 域名**编译进产物**，所以顺序必须是「先填域名 → 再构建 → 再上传」。

1. 编辑 `frontend/.env.production`：

```ini
VITE_API_BASE=https://<API_DOMAIN>
```

要点：必须是 `https://`，**结尾不要带 `/`**，不要带 `/api`。

2. 构建：

```bash
cd frontend
npm install          # 首次或依赖变更时执行
npm run build
```

3. **验证**：`frontend/dist/index.html` 存在，且 `frontend/dist/assets/` 下有 `index-*.js` 和 `index-*.css`。

```bash
ls frontend/dist frontend/dist/assets
```

> 失败判定：`dist` 不存在或只有 `index.html` → 构建失败，看 npm 报错，不要继续。

---

## 阶段 2 · 上传后端

**只上传这 5 项**（`node_modules` 不需要，后端零依赖）：

```bash
# 在本机执行
scp backend/server.js  <BACKEND_HOST>:<API_DIR>/
scp -r backend/lib     <BACKEND_HOST>:<API_DIR>/
scp -r backend/agent   <BACKEND_HOST>:<API_DIR>/      # 可选：给客户机拷 agent 用
scp backend/package.json backend/config.example.json <BACKEND_HOST>:<API_DIR>/
```

**明确不要**上传 `backend/config.json`、`backend/data/`、`backend/start.cmd`（Windows 专用）、`node_modules`。

**验证**（在服务器上）：

```bash
ls <API_DIR>        # 期望：server.js  lib/  agent/  package.json  config.example.json
node -v             # 期望 >= v18
```

> 失败判定：`node -v` 报 command not found → 先装 Node.js 18+（不要继续）。

---

## 阶段 3 · 首次启动后端（生成配置）

```bash
cd <API_DIR>
node server.js
```

首次启动会：生成 `config.json`（站点配置、管理面板密码、两台示例设备 `my-pc` / `my-phone` 及令牌）、创建 `data/`。

**必须记录终端输出**里的两样东西（只打印一次）：

- 管理面板密码（`admin_password`）
- 各设备的 `token`（管理面板里也能复制）

然后 `Ctrl+C` 停掉，改成常驻运行：

```bash
npm i -g pm2
pm2 start server.js --name live-dashboard
pm2 save
pm2 startup        # 按提示执行它输出的那行 sudo 命令，实现开机自启
```

**验证**：

```bash
curl -sS http://127.0.0.1:<PORT>/api/health
```

期望：`{"ok":true,"uptime":...}`

> 失败判定：
> - `config.json 解析失败 Unexpected token '﻿'` → 文件被带 BOM 保存过，删掉 `config.json` 重新首启（**以后只用管理面板改配置**）。
> - `EADDRINUSE` → `<PORT>` 被占用，改 `config.json` 的 `port` 后重启，Nginx 里同步改。
> - `EACCES ... data/` → 目录权限问题，`chown -R` 给运行 pm2 的那个用户。

---

## 阶段 4 · 后端域名：Nginx 反代

写 `/etc/nginx/conf.d/api.conf`：

```nginx
server {
    listen 80;
    server_name <API_DOMAIN>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <API_DOMAIN>;

    ssl_certificate     /etc/letsencrypt/live/<API_DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<API_DOMAIN>/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:<PORT>;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;        # SSE 必须关，否则前端不实时刷新
        proxy_read_timeout 24h;     # SSE 长连接保活
    }
}
```

> 证书还没签发时，先只写 `listen 80` 的 `server`，签发证书后再加 443（见阶段 6）。不要为了"先跑通"把 443 的证书路径指向不存在的文件，Nginx 会直接启动失败。

**验证**：

```bash
sudo nginx -t && sudo nginx -s reload
curl -sS https://<API_DOMAIN>/api/health
```

期望：`{"ok":true,...}`。

> 失败判定：`502` → 后端没起或端口不对；`curl` 报证书错误 → 先完成阶段 6。

---

## 阶段 5 · 上传前端 + 静态托管

```bash
# 本机执行
scp -r frontend/dist/* <WEB_HOST>:<WEB_DIR>/
```

`/etc/nginx/conf.d/web.conf`：

```nginx
server {
    listen 80;
    server_name <WEB_DOMAIN>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <WEB_DOMAIN>;

    ssl_certificate     /etc/letsencrypt/live/<WEB_DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<WEB_DOMAIN>/privkey.pem;

    root <WEB_DIR>;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # /guide、/admin 等 history 路由必须回退
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

**验证**（三个阶段都要过）：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://<WEB_DOMAIN>/
curl -sS -o /dev/null -w "%{http_code}\n" https://<WEB_DOMAIN>/guide
curl -sS -o /dev/null -w "%{http_code}\n" https://<API_DOMAIN>/api/health
```

期望：`200` / `200` / `200`。

> 失败判定：
> - `/guide` 返回 404 → `try_files` 回退缺失。
> - 页面打开空白、控制台报 CORS → 前端构建时 `VITE_API_BASE` 没填或填错（回到阶段 1 重新构建再上传，改服务器文件没用）。
> - 数据一直"加载失败" → 用浏览器直接打开 `https://<API_DOMAIN>/api/health`，不通就是后端/证书问题。

---

## 阶段 6 · 签发证书

```bash
sudo certbot --nginx -d <API_DOMAIN> -d <WEB_DOMAIN>
```

**验证**：两个域名都用浏览器打开，地址栏是小锁图标；`https://<API_DOMAIN>/api/health` 返回 JSON。

---

## 阶段 7 · 端到端验收（全部通过才算部署完成）

按顺序执行，任何一条不符合就停在这条排查：

| # | 动作 | 期望 |
|---|---|---|
| 1 | `https://<API_DOMAIN>/api/health` | `{"ok":true,...}` |
| 2 | `https://<WEB_DOMAIN>/` | 仪表盘出现，无白屏 |
| 3 | `https://<WEB_DOMAIN>/guide`、`/admin` | 可直接访问、刷新不 404 |
| 4 | `https://<API_DOMAIN>/manifest.webmanifest` | 200，`application/manifest+json` |
| 5 | `curl -i -X OPTIONS https://<API_DOMAIN>/api/report -H "Origin: https://<WEB_DOMAIN>"` | `204` + `Access-Control-Allow-Origin: *` |
| 6 | 管理面板登录 → 复制某设备报告地址 | 形如 `https://<API_DOMAIN>/api/report`（自动跟随 `X-Forwarded-*`） |
| 7 | 客户机跑 agent 上报 | 仪表盘 3 秒内出现该设备的应用名 |
| 8 | 管理面板刷新 | 该设备显示在线 |
| 9 | 仪表盘导出 CSV | 下载到 `timeline-<日期>.csv`，Excel 中文不乱码 |
| 10 | `https://<API_DOMAIN>/api/stream?client_id=test`（curl -N） | 持续输出 `: connected` / `event: hello`，连接不掉 |

> 第 5 条如果返回 405/404，说明 Nginx 把 OPTIONS 拦了或后端没跑；跨域放行是后端内置的，**不需要在 Nginx 里加 CORS 头**（重复加会出现两个 `Access-Control-Allow-Origin` 反而报错）。

---

## 客户机接入（部署完成后）

把仓库里的 `backend/agent/` 整个文件夹拷到被监控的 Windows 电脑：

1. 双击 `start-agent.cmd` → 首次弹图形化配置界面；
2. 填 `https://<API_DOMAIN>` + 该设备令牌（管理面板里复制）；
3. 点「测试上报」→ 显示成功后点「保存并启动」；
4. 托盘出现图标即开始后台上报；勾选「开机自动启动」可常驻。

手机走 MacroDroid，请求体模板见 `backend/agent/macrodroid-body.json`，地址同样是 `https://<API_DOMAIN>/api/report`。

---

## 回滚

| 想撤销 | 做法 |
|---|---|
| 前端出问题 | 重新上传上一版 `dist/`（Nginx 不用动） |
| 后端出问题 | `pm2 restart live-dashboard`；代码问题就上传上一版 `server.js`、`lib/` |
| 后端起不来要重置 | 备份后删 `config.json` 与 `data/`，重启（会重新生成密码和示例设备） |
| 关掉整站 | `pm2 delete live-dashboard` + `sudo nginx -s stop` |

---

## 附 A · 单机单域名（仅内部自用可选）

如果你只有一个域名，想省一台机器：一个 Nginx 站点同时给静态文件和 API。

- 前端构建时 `VITE_API_BASE` **留空**（走同源相对路径），重新 `npm run build`；
- Nginx 配置：

```nginx
server {
    listen 443 ssl http2;
    server_name <WEB_DOMAIN>;
    root <WEB_DIR>;

    location /api/ {
        proxy_pass http://127.0.0.1:<PORT>;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 24h;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> 注意：一旦切回双域名，必须再填 `VITE_API_BASE` 并重新构建。

---

## 附 B · Windows 服务器

- 后端：装 Node 18+，在 `backend/` 下双击 `start.cmd`，或 `npm i -g pm2 && pm2 start server.js --name live-dashboard`；
- 前端：`frontend\dist` 用 IIS 站点托管，必须装 **URL Rewrite** 并加 SPA 回退规则（否则 `/guide` 404）；
- HTTPS 用 IIS 证书绑定；
- 防火墙放行 443，后端 3000 只监听回环或仅内网。

---

## 附 C · 给执行部署的 AI 的操作纪律

1. **先读后改**：改动任何服务器文件前先 `cat` 现有内容，避免覆盖别人的配置。
2. **一次一阶段**：每阶段结束必须跑该阶段"验证"，把**实际输出**贴回给用户，不要凭推测说"应该好了"。
3. **禁止把密钥写进代码/文档/提交信息**：密码、令牌只出现在用户的私聊或 `config.json` 里。
4. **破坏性操作先确认**：删除 `config.json` / `data/`、`pm2 delete`、`rm -rf`、改 DNS、重置证书，都要先征得用户同意。
5. **不猜域名**：`<API_DOMAIN>` / `<WEB_DOMAIN>` / `<PORT>` 缺失时直接问用户，不要用 `example.com` 之类的占位值跑真部署。
6. **区分产物与源码**：上传 `frontend/dist`（构建产物），不要上传 `frontend/src`；上传 `backend/` 的 5 项，不要上传 `config.json`、`data/`、`node_modules`。
7. **遇到"改前端没生效"**：99% 是没重新 `npm run build` + 重新上传 `dist`，不要先去改 Nginx。
