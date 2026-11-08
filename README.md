# Live Dashboard · 视监面板

实时设备活动仪表盘：把**电脑**和**手机**正在用的 App 同屏展示在一个网页里，电脑和手机都能随时围观。

**前后端分离，前端与后端各用一个域名**：

- **前端**：Vue 3 + Vite 工程（[frontend/](frontend/)），配置好后 `npm run build` 构建出**纯静态文件**（`frontend/dist`），上传到前端站点即可（Nginx / Vercel / 对象存储都行）；
- **后端**：零依赖 Node.js（[backend/server.js](backend/server.js)），只负责 API、设备上报、存储和 SSE 推送，`node server.js` 一行命令跑起来，不需要数据库；
- **软件端**：同一套前端可打包成 Android APK / iOS App / Windows 桌面程序（[app/](app/) 目录 + [打包教程](app/README.md)）；
- **不同域名**：前端一个域名（如 `web.example.com`）、后端 API 一个域名（如 `api.example.com`）；跨域请求后端已放行（CORS），前端构建时填一次 API 域名即可；
- **密文传输**：电脑 agent 上报自动走 AES-256-CBC + HMAC-SHA256 加密信封，抓包只见密文；
- **统一管理面板**：站点、设备、令牌、数据、密码全部在 `/admin` 可视化配置。

## 来源与致谢

本项目**改编自** [Monika-Dream/live-dashboard](https://github.com/Monika-Dream/live-dashboard)（实时设备活动仪表盘，MIT 协议）。

- 借鉴来源：产品形态（把设备当前应用公开到一页供人围观）、二次元风格界面与樱花装饰、隐私分级思路（聊天/金融/密码类应用整应用匿名化为「私密应用」）、以及「设备上报 → SSE 实时推送」的整体结构；
- 本仓库的差异：前端重写为 Vue 3 + Vite、后端改为零依赖 Node.js + JSON 文件存储、设备端为 Windows 自带 PowerShell 5.1 的零依赖 agent，并新增了**观众远程截屏指令**（电脑弹窗同意/拒绝）、前后端分域名的部署方式与图形化管理面板。

原项目版权归 Monika-Dream 及其贡献者所有，按 MIT 协议授权；本项目同样以 MIT 协议开源，分发时请保留 [LICENSE](LICENSE) 中的版权声明。

```
开发机（你的电脑）                 前端域名 web.example.com          后端域名 api.example.com
──────────────────                 ──────────────────────           ─────────────────────────
frontend/  Vue 3 源码               Nginx（80/443，HTTPS）            Node.js（backend/server.js，pm2 常驻）
  │ 1. .env.production                └──  静态托管 frontend/dist/      ├──  /api/*   全部 API（CORS 已放行）
  │    填后端 API 域名                                                 ├──  POST /api/report  设备上报（AES 解密）
  │ 2. npm run build                                                  ├──  GET  /api/stream  SSE 实时推送
  ▼                                                                   └──  data/db.json      JSON 文件存储
frontend/dist/ 纯静态文件 ──上传──▶
                                                                    app/ ──Capacitor 打包──▶ APK / iOS

浏览器打开前端域名 ──跨域请求 /api/*──▶ 后端域名（CORS 已放行）
设备（agent / MacroDroid）──直接上报──▶ 后端域名 /api/report
```

## 功能特性

- **同屏围观**：所有设备当前应用、电量、在线状态、最近动态、当日时间线一页展示，手机/电脑浏览器均可查看
- **前后端分离**：前端是 Vue 3 构建出的静态文件，后端是零依赖 Node.js；两边独立部署、各用一个域名，跨域由后端 CORS 放行
- **密文传输**：电脑 agent 上报自动走 AES-256-CBC + HMAC-SHA256 加密信封，抓包只见密文
- **实时推送**：SSE（Server-Sent Events）推送，设备一上报页面立刻刷新，无需手动刷新
- **隐私过滤**：聊天、邮件、金融、密码类应用自动匿名化为「私密应用」，窗口标题原文不落盘、不下发
- **统一管理面板**：站点设置、设备/令牌管理、数据清理、密码修改，全部在 `/admin` 可视化完成，保存即生效
- **数据导出**：任意一天的时间线一键导出 CSV / JSON，CSV 带 BOM，Excel 直接打开不乱码
- **数据看板**：当日电量曲线（含充电区间）、应用时长排行、近 90 天使用热力图，直观看出用了多少、什么时候在充
- **AI 总结**：把当天时间线交给大模型写成短评，接口地址自填，支持 OpenAI 兼容 / Claude / Gemini / Ollama 等协议，管理面板可测试连接
- **日期快捷 + 分享链接**：今天/昨天/前后一天一键切换；`?device=xx&date=xx` 打开即保持当前视图，可直接收藏或分享
- **离线通知**：点铃铛授权后，设备掉线时浏览器弹通知（页面打开期间生效）
- **可添加到主屏幕**：带 manifest，手机浏览器可「添加到主屏幕」，打开像独立 App
- **后端零依赖**：Node.js 只用内置模块，无需 `npm install`、无需数据库；前端依赖只在构建时需要

## 目录

- [项目结构](#项目结构)
- [第一步 · 本地跑起来（开发模式）](#第一步--本地跑起来开发模式)
- [第二步 · 配置（管理面板）](#第二步--配置管理面板)
- [第三步 · 构建前端静态文件](#第三步--构建前端静态文件)
- [第四步 · 部署后端（Node.js）](#第四步--部署后端nodejs)
- [第五步 · 部署前端（另一个域名）+ HTTPS](#第五步--部署前端另一个域名--https)
- [电脑接入（PC Agent）](#电脑接入pc-agent)
- [手机接入（MacroDroid）](#手机接入macrodroid)
- [手机端完整配置说明](docs/phone-setup.md)（5 个宏、后台权限、验证与排错）
- [使用原理](#使用原理)
- [配置文件说明](#配置文件说明)
- [API 一览](#api-一览)
- [常见问题](#常见问题)
- [打包成 App（Android APK / iOS / Windows）](app/README.md)（软件端独立文档）
- [AI 部署说明 · 后端 + 前端](AI-DEPLOY.md)（分阶段、可逐步验证的部署手册）
- [来源与致谢](#来源与致谢)

## 项目结构

```
live-dashboard/
├── backend/                    # ★ 后端：零依赖 Node.js
│   ├── server.js               #   入口：API + SSE + 管理接口 + 加密信封
│   ├── lib/
│   │   ├── config.js           #   配置加载/归一化/原子写回
│   │   ├── store.js            #   JSON 文件存储：设备状态、活动记录、保留清理
│   │   └── app-mapper.js       #   应用名映射与私密应用识别
│   ├── agent/                  #   被监控设备端（拷到电脑 / 手机用）
│   │   ├── start-agent.cmd     #     双击：后台启动（首次自动打开配置界面）
│   │   ├── config-agent.cmd    #     双击：打开图形化配置（WinForms）
│   │   ├── stop-agent.cmd      #     双击：停止后台上报
│   │   ├── start-agent.vbs     #     无窗口启动托盘（开机自启指向它）
│   │   ├── agent-ui.ps1        #     配置界面：地址/令牌/间隔/窗口标题/开机自启
│   │   ├── agent-tray.ps1      #     托盘宿主：守护上报进程 + 右键菜单
│   │   ├── agent-common.ps1    #     公共：配置读写、日志、AES 信封、前台采集
│   │   ├── pc-agent.ps1        #     上报主循环（PS 5.1 零依赖）
│   │   └── macrodroid-body.json#     手机 MacroDroid 请求体模板
│   ├── data/db.json            # 运行时数据（自动创建；删除即重置）
│   ├── config.json             # 配置（首次启动自动生成，勿提交公开仓库！）
│   ├── config.example.json
│   ├── package.json
│   └── start.cmd               # Windows 一键启动后端
├── frontend/                   # ★ 前端：Vue 3 + Vite
│   ├── src/
│   │   ├── main.js             #   入口（挂载前先恢复主题）
│   │   ├── router.js           #   路由：/ 仪表盘、/guide 接入指南、/admin 管理面板
│   │   ├── App.vue
│   │   ├── lib/ui.js           #   fetch 封装、主题、格式化工具
│   │   ├── components/CodeBlock.vue
│   │   ├── views/DashboardView.vue   # 仪表盘
│   │   ├── views/GuideView.vue       # 接入指南（含在线测试上报）
│   │   ├── views/AdminView.vue       # 管理面板
│   │   └── styles.css
│   ├── public/                 #   favicon、manifest
│   ├── .env.production         #   构建时填 VITE_API_BASE（后端域名）
│   ├── vite.config.js          #   开发代理：/api → 127.0.0.1:3000
│   ├── package.json
│   ├── dist/                   # ★ npm run build 产物（上传前端站点用）
│   └── legacy/                 # 历史原生前端备份（已被 Vue 取代，可删）
├── app/                        # ★ 软件端：APK / iOS / Windows 打包
│   ├── electron/               #   Electron 主进程（Windows 桌面版）
│   │   └── main.js
│   ├── package.json            #   Electron/Capacitor 依赖 + electron-builder 配置
│   ├── android/ · ios/         #   Capacitor 工程（按教程生成，未生成前不存在）
│   └── README.md               #   APK / iOS / Windows 打包完整教程
├── .gitignore
├── AI-DEPLOY.md               # AI 部署手册（后端 + 前端，分阶段验证）
└── README.md                   # 本文档（总入口）
```

> 前端所有请求统一走 `src/lib/ui.js` 的 `API_BASE`：留空时用相对路径（同域名），填了 `VITE_API_BASE` 就指向后端域名——**不同域名部署只需构建前填一次，代码不用改**。

---

## 第一步 · 本地跑起来（开发模式）

环境要求：**Node.js 18+**（服务器与本机都要）。开两个终端：

**终端 1 —— 启动后端（端口 3000）**

```bash
cd backend
node server.js
```

首次启动会自动：

1. 生成 `config.json`：站点配置、**管理面板密码**、两台示例设备（`my-pc` / `my-phone`）及各自的上报令牌——密码和令牌会打印一次在日志里；
2. 创建 `data/` 目录存放数据文件。

**终端 2 —— 启动前端开发服务器（端口 5173）**

```bash
cd frontend
npm install
npm run dev
```

打开 `http://localhost:5173` 即可看到仪表盘（Vite 已把 `/api` 自动代理到 3000，改前端代码热更新）。

| 页面 | 开发地址 | 说明 |
|---|---|---|
| 仪表盘 | `http://localhost:5173/` | 电脑手机同屏围观（公开只读） |
| 接入指南 | `http://localhost:5173/guide` | 手机/电脑接入 + 部署说明（可在线测试上报） |
| 管理面板 | `http://localhost:5173/admin` | 全部配置入口（需密码登录） |

> Windows 上不想敲命令，也可以直接双击 `backend\start.cmd`（等价于终端 1）。

---

## 第二步 · 配置（管理面板）

**先配置，再构建**。配置全部存在后端的 `config.json` 里（管理面板改动即时写回并生效），前端构建出的静态文件里不含任何站点配置——所以站点配置什么时候改都行，改完**不需要重新构建**（只有后端 API 域名变了才需要重新构建，见第三步）。

浏览器打开管理面板（开发模式是 `http://localhost:5173/admin`，线上是 `https://你的域名/admin`），用首次启动日志里打印的密码登录：

| 分区 | 能做什么 |
|---|---|
| 站点设置 | 站点名称、描述、离线判定秒数、数据保留天数，保存即时生效无需重启 |
| 设备管理 | 添加/改名/删除设备（Windows / macOS / Linux / Android / iOS）；查看与复制令牌；一键重新生成令牌（旧的立即失效）；每台设备附上报地址、MacroDroid 请求体、curl、agent 启动命令模板，直接复制去用 |
| 数据管理 | 查看记录数/占用空间，按设备或全部清空数据 |
| 修改密码 | 修改管理密码（至少 6 位）；改完其他已登录会话立即失效 |

**要点**：

- 令牌就是设备上报的凭据（相当于密码），**别发到公开群聊或截图里**；泄露就到面板里重新生成
- 首次自动创建的 `my-pc` / `my-phone` 两台设备可以直接改名使用，不需要的可以删除
- 手动改 `config.json` 也行（字段见[配置文件说明](#配置文件说明)），改完重启后端生效

---

## 第三步 · 构建前端静态文件

**前后端用不同域名时，构建前先告诉前端后端 API 的地址**：编辑 `frontend/.env.production`，把 `VITE_API_BASE` 填成后端 API 域名（结尾不带 `/`）：

```ini
# frontend/.env.production
VITE_API_BASE=https://api.example.com
```

留空则走同源相对路径（本地开发 / 后端托管 dist 的部署方式）。然后构建：

```bash
cd frontend
npm install        # 首次或依赖变更时执行
npm run build
```

构建产物在 **`frontend/dist/`**：

```
frontend/dist/
├── index.html
└── assets/
    ├── index-xxxxxx.css    # 全部样式
    └── index-xxxxxx.js     # 全部逻辑（Vue 打包）
```

这就是「前端」，它只是几个静态文件，**谁都能托管它**——上传到前端站点的目录，由 Nginx（或 Vercel 等静态托管）指向它即可（下一步）。

> 以后改了前端代码 / 样式，重新 `npm run build` 再重新上传 `dist/` 就行；只改配置（站点名、设备、令牌）则完全不用重新构建。

---

## 第四步 · 部署后端（Node.js）

后端只需要 `backend/` 里的这几个文件（前端的 `frontend/`、`node_modules` 都不用上传）：

```
backend/
├── server.js          # 后端入口
├── lib/               # 后端模块
├── agent/             # 可选：电脑 agent（给被监控的电脑用，不是服务器用）
├── package.json
├── config.example.json
└── start.cmd          # Windows 一键启动（Linux 直接 node server.js）
```

### 1. 上传到服务器

把 `backend/` 整个目录上传到例如 `/opt/live-dashboard/backend`（scp / 宝塔 / FTP 都行）。scp 示例（在本机执行）：

```bash
scp -r backend root@后端服务器IP:/opt/live-dashboard/
```

### 2. 启动并常驻

服务器装好 Node.js 18+ 后：

```bash
cd /opt/live-dashboard/backend
node server.js                # 先跑一次：生成 config.json、拿到管理密码

# 后台常驻（推荐 pm2）
npm i -g pm2
pm2 start server.js --name live-dashboard
pm2 save && pm2 startup       # 开机自启
```

至此后端已在 `127.0.0.1:3000` 监听，下一步由 Nginx 把 API 域名反代过来。

---

## 第五步 · 部署前端（另一个域名）+ HTTPS

前端（`frontend/dist`，第三步的构建产物）和后端 API **各用一个域名**，例如 `web.example.com` 和 `api.example.com`，两个域名都解析 A 记录到各自服务器，安全组放行 80 / 443。

### 1. 后端域名：Nginx 反代 Node.js

`/etc/nginx/conf.d/api.conf`——整站反代到 3000：

```nginx
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;   # 让后端生成 https:// 的上报地址
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;        # ★ SSE 实时推送必须关闭缓冲，否则页面不实时刷新
        proxy_read_timeout 24h;     # ★ SSE 长连接保活
    }
}
```

> 后端服务器不想装 Nginx 也行：直接在 `config.json` 里启用内置 HTTPS（方案 D，见下），把 443 端口直接给 Node。

### 2. 前端域名：Nginx 静态托管 dist

把 `frontend/dist/` 上传到前端服务器（如 `/var/www/live-dashboard`），`/etc/nginx/conf.d/web.conf`：

```nginx
server {
    listen 80;
    server_name web.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name web.example.com;

    ssl_certificate     /etc/letsencrypt/live/web.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/web.example.com/privkey.pem;

    root /var/www/live-dashboard;
    index index.html;

    location / {
        # Vue Router history 模式：/guide、/admin 等路径回退到 index.html
        try_files $uri $uri/ /index.html;
    }

    # 带指纹的静态资源，放心长缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

> 前端也可以不用自己的服务器：Vercel / Netlify / 对象存储 + CDN 都能直接托管 `dist/`（SPA 应用记得把 rewrite 规则设为全部回退 `index.html`）。

重载 Nginx 并给两个域名签发证书：

```bash
sudo nginx -t && sudo nginx -s reload
sudo certbot --nginx -d api.example.com -d web.example.com
```

**验证**：打开 `https://web.example.com` 能看到仪表盘且数据正常加载；`https://api.example.com/api/health` 返回 JSON，就说明两个域名都通了。

### 3. 跨域说明

前端域名调用后端 API 属于跨域请求，后端已经内置放行（无需任何配置）：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Device-Token
```

前端要做的只有一件事：构建时 `VITE_API_BASE` 填对（第三步）。另外两个域名**都必须是 HTTPS**——浏览器禁止 HTTPS 页面请求 HTTP 接口（混合内容会被直接拦截）。

> 上报地址会自动正确：后端按 `X-Forwarded-Host` / `X-Forwarded-Proto` 生成 `report_url`，管理面板和接入指南里复制的地址自动就是 `https://api.example.com/api/report`。

### 4. 替代方案

| 方案 | 说明 |
|---|---|
| **A. 两个域名（上面讲的）** | 前端静态文件与后端 API 完全独立，各挂各的域名，互不影响 |
| **B. 同域名分流** | 以后想省一个域名时：一个域名下 Nginx 把 `/` 给 dist、`/api` 反代 3000。前端 `VITE_API_BASE` 留空重新构建即可，两种方式随时可切换 |
| **C. Caddy** | 两个站点自动 HTTPS：`api.example.com { reverse_proxy 127.0.0.1:3000 }`；`web.example.com { root * /var/www/live-dashboard; file_server; try_files {path} /index.html }` |
| **D. Node 内置 HTTPS** | 后端不装 Nginx：`config.json` 配 `https.enabled/cert/key`，Node 直接监听 443 对外提供 API（证书读取失败会自动回退 HTTP 并在日志提示） |

> 手机 MacroDroid 上报的是明文 JSON，**上公网务必配 HTTPS**——这就是本步骤存在的原因。

---

## 电脑接入（PC Agent）

电脑端只需要 `backend/agent/` 这个文件夹（Windows 自带 PowerShell 5.1 即可跑，零依赖）。

### 固定配置一览（照这个套）

| 项 | 值 | 说明 |
|---|---|---|
| 上报地址 | `https://api.example.com` | 只填域名即可，脚本自动补 `/api/report` |
| 令牌 | 管理面板「设备管理」里该电脑的 `token` | 相当于该设备的密码，别外传 |
| 加密 | 自动开启 | AES-256-CBC + HMAC-SHA256，无需配置 |
| 检查间隔 | 10 秒 | 前台应用变化即上报 |
| 心跳间隔 | 60 秒 | 应用不变也每 60 秒报一次，避免误判离线 |
| 窗口标题 | 开 | 关掉后只传应用名，更隐私 |

### 方式一：双击 + 图形化配置（推荐）

1. 把 `backend/agent/` 整个文件夹拷到被监控的电脑上（例如 `D:\live-dashboard\agent\`）；
2. 双击 **`start-agent.cmd`**：
   - 首次运行会自动弹出配置界面（Windows 自带 WinForms，不用装任何东西）；
   - 已配置过则直接隐藏窗口在后台启动，任务栏出现托盘图标。
3. 在配置界面里填**后端地址**和**设备令牌**，可先点「测试上报」确认通了（仪表盘会短暂出现「Windows 客户机配置测试」），再点「保存并启动」。

配置界面还能设置：检查间隔、心跳间隔、是否上报窗口标题、是否开机自启（写入 `HKCU\...\Run`，指向 `start-agent.vbs`）。

| 操作 | 怎么做 |
|---|---|
| 改配置 | 双击 `config-agent.cmd`，或右键托盘图标 →「打开配置」 |
| 查看日志 | 右键托盘 →「查看日志」（打开 `%LOCALAPPDATA%\LiveDashboardAgent\agent.log`） |
| 重启上报 | 右键托盘 →「重启上报」（改完配置保存也会自动重启） |
| 停止 | 右键托盘 →「退出」，或双击 `stop-agent.cmd` |
| 开机自启 | 配置界面勾选「开机自动启动」后保存 |

> 配置文件与日志都在 `%LOCALAPPDATA%\LiveDashboardAgent\`：`config.json`、`agent.log`。卸载 = 停止 + 删掉这个目录 + 取消勾选开机自启。

### 方式二：命令行（适合脚本/远程部署）

```powershell
powershell -ExecutionPolicy Bypass -File agent\pc-agent.ps1 `
  -ServerUrl https://api.example.com `
  -Token 电脑令牌
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `-ServerUrl` | 读配置文件 | 只写域名也行，脚本会自动补 `/api/report` |
| `-Token` | 读配置文件 | 设备令牌 |
| `-IntervalSeconds` | 10 | 检查前台窗口的间隔 |
| `-HeartbeatSeconds` | 60 | 心跳间隔 |
| `-SendWindowTitle` | `$true` | 传 `$false` 则只上报应用名 |
| `-ConfigPath` | `%LOCALAPPDATA%\LiveDashboardAgent\config.json` | 指定配置文件（日志写到同目录） |

- 停止：窗口内 `Ctrl+C`
- 电脑锁屏（无前台窗口）时不上报，面板按离线判定显示离线

### 校验一下有没有通

```powershell
Invoke-RestMethod -Uri https://api.example.com/api/health
```

返回 `ok : True` 说明后端地址正确；再启动 agent，面板上该设备应在几秒内变成在线。

## 手机接入（MacroDroid）

手机无需安装额外 App，用 [MacroDroid](https://www.macrodroid.com/)（免费版够用）建一个宏。请求体模板已放在 [backend/agent/macrodroid-body.json](backend/agent/macrodroid-body.json)，直接复制粘贴即可。

> 完整步骤、息屏上报、后台保活与排错见 [手机端配置说明](docs/phone-setup.md)。

### 固定配置一览（照这个套）

| 项 | 值 |
|---|---|
| 触发器 1 | 应用启动/切换（勾选常用应用） |
| 触发器 2 | 定时器，每 1 分钟（防止长时间停留不刷新） |
| 动作 | HTTP 请求（HTTP Request） |
| 方法 | `POST` |
| URL | `https://api.example.com/api/report` |
| 内容类型 | `application/json` |
| 请求头 | `Authorization: Bearer <手机令牌>` |
| 请求体 | 见下方 JSON（与 `backend/agent/macrodroid-body.json` 一致） |

```json
{
  "app_id": "{app_package}",
  "app_label": "{app_name}",
  "battery_percent": {battery},
  "window_title": "{window_title}"
}
```

- 上面这些占位符都是 MacroDroid 魔变文本，插入时自动替换；不确定写法就点输入框旁的「…」从列表插入「前台应用名称 / 前台应用包名 / 电池电量」，不要手打占位符。
- `battery_percent` 会显示在面板的设备卡片上；有的机型没有 `{battery}` 或 `{window_title}`：把对应那一行整行删掉，其余照常工作。
- **充电状态**：再建两个小宏 `PowerOn` / `PowerOff`，触发器选「电池 → 电源连接/断开」，分别选「电源已连接」「电源已断开」，请求体只写 `{"battery_charging":true}` / `{"battery_charging":false}`（URL、令牌同上）。面板会立即显示「⚡ 充电中」或「🔋 未充电」。
- **息屏不计时**：再建两个小宏 `ScreenOff` / `ScreenOn`，触发器分别选「屏幕关闭」「屏幕开启」，请求体只写 `{"screen_on":false}` / `{"screen_on":true}`（URL、令牌同上）。服务端会自动沿用这台手机上一次的应用，不用填 `app_id`；息屏期间时间线显示为灰色，且不计入使用时长。
- 如果 MacroDroid 版本找不到自定义请求头，可以把令牌放到 URL 上，效果一样：`https://api.example.com/api/report?token=<手机令牌>`。
- 聊天/邮件/银行类应用的窗口标题会被服务端自动过滤，不会落盘。

### 校验一下有没有通

先在电脑上用 curl 测一次令牌和地址（换成你自己的）：

```bash
curl -X POST "https://api.example.com/api/report" \
  -H "Authorization: Bearer <手机令牌>" \
  -H "Content-Type: application/json" \
  -d '{"app_id":"com.tencent.mm","app_label":"微信","battery_percent":73}'
```

返回 `{"ok":true,...}` 就说明通了，1~2 秒内面板上会出现这台手机。也可以在 `/guide` 页面用「在线测试上报」表单直接试。

> 令牌在管理面板里随时查看/复制/重新生成；重新生成后旧令牌立即失效，记得同步改设备上的配置。

---

## 使用原理

### 数据流

```
设备（agent / MacroDroid）
   │  POST /api/report（带设备令牌鉴权）
   ▼
Node.js：验令牌 → 解密（若是信封）→ 归一化字段 → 隐私过滤
   │                                   │
   │  内存中保存设备最新状态             │ 活动记录追加进 data/db.json（10 秒防抖落盘）
   ▼                                   ▼
SSE 广播 /api/stream ──▶ 前端页面实时刷新；页面也定期拉取 /api/current 兜底
```

- **前端是纯静态文件**：`frontend/dist` 托管在前端域名，页面通过 `VITE_API_BASE` 指定的后端域名调用 `/api/*`，跨域由后端 CORS 头放行
- **不需要数据库**：数据就是一个 JSON 文件 `data/db.json`（当前状态 + 活动记录），写入用「临时文件 + 原子重命名」保证不写坏；超出保留天数或超过 8000 条自动清理。这个量级对个人使用完全够，想换 SQLite/MySQL 只需改 `lib/store.js` 一个文件
- **SSE 事件**：`hello`（连接时下发围观人数与服务器时间）、`update`（有设备上报时通知刷新）、`viewers`（围观人数变化）

### 加密传输原理（电脑 agent）

选 AES-256-CBC + HMAC-SHA256（encrypt-then-MAC）而不是 AES-GCM，是为了兼容 Windows 自带的 PowerShell 5.1（它没有 GCM 实现）。密钥从设备令牌派生，**令牌本身不参与加密以外的传输，也不存进数据库**：

```
base   = SHA256(设备令牌)
encKey = SHA256(base + 0x01)     ← AES-256-CBC 加密密钥
macKey = SHA256(base + 0x02)     ← HMAC-SHA256 验签密钥

明文 JSON ──AES-CBC(PKCS7)──▶ 密文
请求体 = { "enc": 1, "iv": base64, "data": base64, "mac": base64 }
其中 mac = HMAC-SHA256(macKey, iv ‖ 密文)
```

服务器收到后：先重算 HMAC 对比（防篡改，`timingSafeEqual` 防时序攻击）→ 再解密 → 再解析 JSON。任何一步失败直接 400 拒绝。抓包者只能看到 `iv/data/mac` 三段 base64，没有令牌就推不出密钥。

手机 MacroDroid 的宏没有加密能力，走明文 JSON，所以**必须靠 HTTPS 保护**——这就是部署章节强调配域名 + HTTPS 的原因。

### 隐私过滤

`lib/app-mapper.js` 内置应用名映射与敏感类别识别：微信、QQ、Telegram、邮箱、银行、密码管理器等会被整体匿名化为「私密应用」——面板只显示「正在用私密应用」和使用时长，**窗口标题不落盘、不发给前端**；普通应用才展示标题。

---

## 配置文件说明

`config.json`（首次启动自动生成，管理面板改动会自动写回）：

| 字段 | 说明 |
|---|---|
| `site.name` / `site.description` | 面板标题与副标题（管理面板可改） |
| `port` | 后端服务端口，默认 3000（被 Nginx 反代，无需对外开放） |
| `offline_after_seconds` | 多久没上报算离线，默认 120 秒 |
| `retention_days` | 活动记录保留天数，默认 7 天 |
| `admin_password` | 管理面板密码；留空/删掉则启动时自动生成并打印一次 |
| `https.enabled/cert/key` | 内置 HTTPS 开关与证书路径（不用 Nginx 时的方案 D） |
| `devices[].id/name/platform/token` | 设备列表：`platform` 取 windows/android/macos/linux/ios，`token` 为上报令牌（相当于该设备的密码） |

支持环境变量：`CONFIG_FILE`（配置路径）、`DATA_DIR`（数据目录）。

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/report` | `Bearer <设备令牌>` | 设备上报。支持加密信封 `{enc,iv,data,mac}` / 明文 JSON / 表单 |
| GET | `/api/current` | 公开 | 所有设备当前状态 + 最近动态 + 围观人数 |
| GET | `/api/timeline?date=YYYY-MM-DD&tz=480&device_id=` | 公开 | 当日活动时间线（`tz` 为分钟时区偏移） |
| GET | `/api/export?date=YYYY-MM-DD&tz=480&device_id=&format=csv\|json` | 公开 | 导出指定日期的时间线，CSV 含 BOM 可直接用 Excel 打开 |
| GET | `/api/config` | 公开 | 站点配置与上报地址 |
| GET | `/api/stream` | 公开 | SSE 实时推送（设备状态、围观人数） |
| GET | `/api/health` | 公开 | 健康检查 |
| POST | `/api/admin/login` | — | 管理登录，返回会话令牌 |
| GET | `/api/admin/overview` | 管理会话 | 站点/设备/统计总览 |
| POST | `/api/admin/settings` | 管理会话 | 保存站点设置 |
| POST | `/api/admin/devices` | 管理会话 | 添加设备 |
| POST | `/api/admin/devices/update` | 管理会话 | 修改设备 |
| POST | `/api/admin/devices/delete` | 管理会话 | 删除设备（连带清其数据） |
| POST | `/api/admin/devices/token` | 管理会话 | 重新生成设备令牌 |
| POST | `/api/admin/data/clear` | 管理会话 | 清空数据（`device_id` 可选，按设备清） |
| POST | `/api/admin/password` | 管理会话 | 修改管理密码 |

**上报字段**（明文时的 JSON 结构；agent 的密文解开后也是这个结构）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `app_id` | 是 | 应用标识，如 `com.tencent.mm` / `chrome.exe` |
| `app_label` | 否 | 应用显示名，如 `微信` |
| `window_title` | 否 | 窗口标题（私密应用会被过滤） |
| `battery_percent` | 否 | 电量 0-100 |
| `battery_charging` | 否 | 是否充电 |
| `screen_on` | 否 | 屏幕是否亮着；`false` 表示息屏，该时段不计入使用时长 |
| `timestamp` | 否 | 上报时间（偏差超 5 分钟用服务器时间） |
| `extra` | 否 | 任意附加 JSON 对象 |

## 常见问题

- **改了前端代码怎么生效？** `cd frontend && npm run build`，把新的 `frontend/dist/` 重新上传到前端站点即可，不用重启后端。
- **只改了站点名/设备/令牌要重新构建吗？** 不用。这些配置存在后端 `config.json`，管理面板改完即时生效。
- **前端打开空白 / 控制台报 CORS 错？** 确认构建前 `frontend/.env.production` 里的 `VITE_API_BASE` 填的是后端 API 域名（结尾不带 `/`），且前后端都是 HTTPS（HTTP 页面调 HTTPS 接口可以，反过来会被浏览器拦截）。
- **`/guide`、`/admin` 打不开（404）？** 前端 Nginx 必须配 `try_files $uri $uri/ /index.html;`（SPA 回退），见第五步完整配置；Vercel 等托管要把 rewrite 规则设为全部回退 `index.html`。
- **面板不实时刷新？** 走 Nginx 反代的话确认配置了 `proxy_buffering off` 和 `proxy_read_timeout 24h`（SSE 必需）。
- **忘记管理密码？** 打开 `config.json` 删掉 `admin_password` 字段后重启服务，会重新生成并打印；或直接把该字段改成新值（至少 6 位）。
- **令牌泄露了？** 管理面板「重新生成令牌」，旧的立即失效，设备端换新令牌即可。
- **想彻底清空数据？** 管理面板「数据管理 → 全部清空」，或直接删除 `data/db.json`。
- **面板显示离线但设备在用？** 检查设备端令牌/地址；电脑锁屏时本来就不上报；管理面板里可调「离线判定秒数」。
- **端口被占用？** 改 `config.json` 的 `port` 后重启后端。
- **安全提醒**：`config.json` 里是明文令牌与管理密码，**不要提交到公开仓库**，服务器上注意文件权限。

---

MIT License · 详见 [LICENSE](LICENSE)。本项目改编自 [Monika-Dream/live-dashboard](https://github.com/Monika-Dream/live-dashboard)，感谢原作者与贡献者。
