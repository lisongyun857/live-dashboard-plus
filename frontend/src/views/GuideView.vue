<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, toggleTheme, ICON_MOON, ICON_SUN, API_BASE } from '../lib/ui';
import CodeBlock from '../components/CodeBlock.vue';

const reportUrl = ref(`${API_BASE || window.location.origin}/api/report`);

const curlExample = computed(
  () => `curl -X POST "${reportUrl.value}" \\
  -H "Authorization: Bearer <手机令牌>" \\
  -H "Content-Type: application/json" \\
  -d '{"app_id":"com.tencent.mm","app_label":"微信","battery_percent":73}'`
);

const macroBody = `{
  "app_id": "{app_package}",
  "app_label": "{app_name}",
  "battery_percent": {battery},
  "battery_charging": {power}
}`;

const agentCmd = `powershell -ExecutionPolicy Bypass -File agent\\pc-agent.ps1 -ServerUrl https://你的后端API域名 -Token 电脑令牌`;

const deployCmd = `cd backend
node server.js
# 后台常驻（推荐 pm2）
npm i -g pm2
pm2 start server.js --name live-dashboard
pm2 save && pm2 startup`;

const buildCmd = `# 1. 先在 frontend/.env.production 里填后端 API 域名（结尾不带 /）
#    VITE_API_BASE=https://api.example.com
# 2. 构建：
cd frontend
npm install
npm run build          # 产物在 frontend/dist，是纯静态文件`;

const httpsCfg = `{
  "https": { "enabled": true, "cert": "/etc/ssl/live-dashboard/fullchain.pem", "key": "/etc/ssl/live-dashboard/privkey.pem" }
}`;

// ── 在线测试表单 ───────────────────────────────────────────────────────
const testToken = ref('');
const testAppId = ref('com.tencent.mm');
const testAppLabel = ref('微信');
const testBattery = ref('73');
const testResult = ref({ cls: '', text: '' });

async function submitTest() {
  const token = testToken.value.trim();
  const appId = testAppId.value.trim();
  const appLabel = testAppLabel.value.trim();
  const battery = Number(testBattery.value);

  if (!token) {
    testResult.value = { cls: 'bad', text: '请先填手机令牌。' };
    return;
  }
  if (!appId) {
    testResult.value = { cls: 'bad', text: 'app_id 不能为空。' };
    return;
  }

  const payload = { app_id: appId };
  if (appLabel) payload.app_label = appLabel;
  if (Number.isFinite(battery)) payload.battery_percent = Math.max(0, Math.min(100, battery));

  testResult.value = { cls: '', text: '发送中…' };
  try {
    const res = await fetch(`${API_BASE}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      testResult.value = { cls: 'ok', text: `上报成功：${data.app_name || appId}（${data.status_text || ''}）` };
      setTimeout(() => {
        window.location.href = '/';
      }, 1200);
    } else {
      testResult.value = { cls: 'bad', text: `上报失败（${res.status}）：${data.error || '未知错误'}` };
    }
  } catch (err) {
    testResult.value = { cls: 'bad', text: `网络错误：${err.message}` };
  }
}

onMounted(async () => {
  document.title = '接入指南 · Live Dashboard';
  try {
    const config = await api('/api/config');
    if (config.report_url) reportUrl.value = config.report_url;
  } catch {
    // 用当前地址兜底
  }
});
</script>

<template>
  <div class="petals" aria-hidden="true">
    <span></span><span></span><span></span><span></span>
  </div>

  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M10.5 18.5h3" />
          </svg>
        </div>
        <div class="brand-text">
          <h1>接入指南</h1>
          <p class="brand-sub">手机 MacroDroid · 电脑 Agent · 服务器部署</p>
        </div>
      </div>
      <div class="header-meta">
        <button class="icon-btn" type="button" aria-label="切换深浅色" @click="toggleTheme">
          <span v-html="ICON_MOON"></span>
          <span v-html="ICON_SUN"></span>
        </button>
        <router-link class="ghost-btn" to="/">返回面板</router-link>
      </div>
    </div>
  </header>

  <main class="page guide-page">
    <section class="hero guide-hero card">
      <div>
        <p class="hero-kicker">GETTING STARTED</p>
        <h1>把电脑和手机都接进面板</h1>
        <p>手机用 MacroDroid 宏上报，电脑跑一个 PowerShell 小 agent（自带 AES 加密），服务部署在服务器上，设备发 POST、面板拉数据展示。所有配置都能在管理面板里完成。</p>
      </div>
    </section>

    <section class="card guide-section">
      <h2 style="font-size: 16px">手机接入（MacroDroid）</h2>
      <p class="section-note">无需安装 App，用宏自动上报当前应用</p>

      <div class="step">
        <span class="step-num">1</span>
        <div class="step-body">
          <h3>拿到手机令牌</h3>
          <p>第一次启动服务时会自动生成 <span class="inline-code">config.json</span>，其中 <span class="inline-code">devices</span> 里 <span class="inline-code">my-phone</span> 的 <span class="inline-code">token</span> 就是手机令牌（启动日志里也会打印一次）。也可以直接在 <router-link to="/admin" style="color: var(--accent); font-weight: 600">管理面板</router-link> 里查看、复制或重新生成令牌。</p>
          <p>令牌相当于密码，<b>不要发到公开群聊或截图里</b>。想换令牌，在管理面板里一键重新生成即可。</p>
        </div>
      </div>

      <div class="step">
        <span class="step-num">2</span>
        <div class="step-body">
          <h3>确认上报地址</h3>
          <p>手机和电脑连同一个 Wi-Fi 时，用下面这个地址（如果部署到了服务器，就是服务器的公网地址）：</p>
          <CodeBlock :code="reportUrl" />
        </div>
      </div>

      <div class="step">
        <span class="step-num">3</span>
        <div class="step-body">
          <h3>在 MacroDroid 新建宏</h3>
          <p><b>触发器</b>：加“应用启动/切换”（Application Launched / App Changed），把常用的应用勾上；再加一个“定时器”每 1 分钟触发一次，避免长时间停留时状态不刷新。</p>
          <p><b>动作</b>：添加“HTTP 请求”（HTTP Request），按下表填写：</p>
          <table class="field-table">
            <thead>
              <tr><th>字段</th><th>填什么</th></tr>
            </thead>
            <tbody>
              <tr><td>方法</td><td><code>POST</code></td></tr>
              <tr><td>URL</td><td>上一步的地址</td></tr>
              <tr><td>内容类型</td><td><code>application/json</code></td></tr>
              <tr><td>请求头</td><td><code>Authorization: Bearer &lt;手机令牌&gt;</code></td></tr>
              <tr><td>请求体</td><td>见下方 JSON</td></tr>
            </tbody>
          </table>
          <p>请求体里的占位符都是 MacroDroid 的魔变文本，插入时会自动替换成实际值。请点输入框旁的「…」按钮，从列表里插入「前台应用名称 / 前台应用包名 / 电池电量 / 充电状态（Power on/off）」，不要直接手打占位符（不同版本的名字可能不一样）。</p>
          <CodeBlock :code="macroBody" />
          <p><span class="inline-code">battery_percent</span> 和 <span class="inline-code">battery_charging</span> 会显示在面板的设备卡片上。如果某些机型没有对应魔变文本，把那一行删掉也能正常工作。</p>
          <p>想同时上报窗口标题，可以加 <span class="inline-code">"window_title": "{window_title}"</span>（聊天、银行等私密应用会自动隐藏标题）。</p>
          <p>如果你的 MacroDroid 版本找不到自定义请求头，也可以把令牌放到 URL 后面：<span class="inline-code">/api/report?token=&lt;手机令牌&gt;</span>，效果一样。</p>
          <p><b>息屏不计时</b>：再建两个小宏，触发器分别选「屏幕关闭」和「屏幕开启」，动作都是一个 HTTP 请求，请求体只写 <span class="inline-code">{"screen_on":false}</span> 和 <span class="inline-code">{"screen_on":true}</span>（URL、令牌同上）。服务端会自动沿用这台手机上一次的应用，不用再填 <span class="inline-code">app_id</span>；息屏期间的时间线会显示为灰色且不计入时长。</p>
        </div>
      </div>

      <div class="step">
        <span class="step-num">4</span>
        <div class="step-body">
          <h3>测试一下</h3>
          <p>可以在电脑上先用 curl 验证令牌和地址（把地址与令牌换成你自己的）：</p>
          <CodeBlock :code="curlExample" />
          <p>返回 <span class="inline-code">{"ok":true}</span> 就说明通了，面板上会立刻出现这台手机。</p>
        </div>
      </div>
    </section>

    <section class="card guide-section">
      <h2 style="font-size: 16px">电脑接入（PC Agent）</h2>
      <p class="section-note">Windows 自带 PowerShell 即可运行，敏感信息全程加密上报</p>
      <div class="step">
        <span class="step-num">1</span>
        <div class="step-body">
          <h3>拿到电脑令牌</h3>
          <p>打开 <router-link to="/admin" style="color: var(--accent); font-weight: 600">管理面板</router-link>，登录后在「设备管理」里找到电脑设备，复制令牌（首次登录的密码在服务第一次启动的日志里打印过，也可以在面板里修改）。</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <div class="step-body">
          <h3>运行 agent</h3>
          <p>把项目里的 <span class="inline-code">backend/agent/</span> 整个文件夹拷到电脑上（比如 <span class="inline-code">D:\live-dashboard\agent\</span>），双击 <span class="inline-code">start-agent.cmd</span>：首次运行会弹出图形化配置界面，填好后端地址和令牌、点「测试上报」确认通了，再点「保存并启动」。</p>
          <p>之后它隐藏窗口在后台运行，任务栏出现托盘图标（右键可「打开配置 / 查看日志 / 重启上报 / 退出」）；报文自动走 <b>AES-256 加密 + HMAC 防篡改</b>。也可以走命令行：</p>
          <CodeBlock :code="agentCmd" />
        </div>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <div class="step-body">
          <h3>开机自启（可选）</h3>
          <p>在配置界面勾选「开机自动启动」后保存即可（写入当前用户 <span class="inline-code">HKCU\...\Run</span>，指向 <span class="inline-code">start-agent.vbs</span>，开机后隐藏窗口自动上报）。</p>
        </div>
      </div>
    </section>

    <section class="card guide-section">
      <h2 style="font-size: 16px">部署到服务器（前后端分离 · 不同域名）</h2>
      <p class="section-note">前端静态文件放前端域名，后端 Node.js 提供 API，跨域后端已放行</p>
      <div class="step">
        <span class="step-num">1</span>
        <div class="step-body">
          <h3>构建前端静态文件</h3>
          <p>先在 <span class="inline-code">frontend/.env.production</span> 里把 <span class="inline-code">VITE_API_BASE</span> 填成后端 API 域名，再构建：</p>
          <CodeBlock :code="buildCmd" />
          <p>构建产物 <span class="inline-code">frontend/dist/</span> 是纯静态文件，上传到<b>前端域名</b>的站点目录（Nginx、Vercel、对象存储都行）。改了前端代码就重新构建上传；只改配置则不用。</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <div class="step-body">
          <h3>启动后端 Node 服务（API 域名）</h3>
          <p>把 <span class="inline-code">backend/</span> 整个目录（含 <span class="inline-code">server.js</span>、<span class="inline-code">lib/</span>、<span class="inline-code">agent/</span>）传到后端服务器，装好 Node.js 18+：</p>
          <CodeBlock :code="deployCmd" />
          <p>首次启动会自动生成 <span class="inline-code">config.json</span> 与管理面板密码（打印在日志里），并创建 <span class="inline-code">data/</span> 数据目录。后端只监听本机 3000 端口，由 Nginx 反代到 API 域名。</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <div class="step-body">
          <h3>两个域名分别配置 Nginx</h3>
          <p><b>前端域名</b>（如 <code>web.example.com</code>）：静态托管 dist，并做 <code>try_files $uri $uri/ /index.html</code> 的 history 路由回退（用 Vercel 等静态托管则零配置）。</p>
          <p><b>后端域名</b>（如 <code>api.example.com</code>）：整站反代到 Node 3000，<b>必须关闭缓冲</b>（SSE 实时推送需要）。后端已返回 <code>Access-Control-Allow-Origin: *</code>，跨域请求前端无需任何处理。</p>
          <p>两份完整 Nginx 配置见 README 的「部署到服务器」章节。</p>
        </div>
      </div>
      <div class="step">
        <span class="step-num">4</span>
        <div class="step-body">
          <h3>两个域名都开启 HTTPS</h3>
          <p>手机 MacroDroid 上报的是明文 JSON，必须配 HTTPS；且浏览器禁止 HTTPS 页面请求 HTTP 接口，所以<b>前后端两个域名都要配</b>。前端用 Nginx + Let's Encrypt，后端用 Nginx 或在 <span class="inline-code">config.json</span> 里启用内置 HTTPS：</p>
          <CodeBlock :code="httpsCfg" />
          <p>证书路径填 fullchain 与私钥的绝对路径，重启服务生效；证书读取失败会自动回退 HTTP 并在日志里提示。</p>
        </div>
      </div>
    </section>

    <section class="card guide-section">
      <h2 style="font-size: 16px">加密传输与隐私说明</h2>
      <p class="section-note">敏感信息（窗口标题等）密文上送，服务器只存脱敏结果</p>
      <p><b>电脑端</b>：agent 的每次上报都是一个加密信封——用设备令牌在本地派生密钥，AES-256-CBC 加密 + HMAC-SHA256 完整性校验（encrypt-then-MAC），服务器先验签再解密，抓包只能看到密文；令牌本身不随请求明文之外传输（仅作密钥来源与鉴权）。</p>
      <p><b>手机端</b>：MacroDroid 无法在宏里做应用层加密，上报的是明文 JSON，因此<b>请务必让上报地址走 HTTPS</b>（反向代理或内置 HTTPS 均可），浏览面板同样建议全程 HTTPS。</p>
      <p><b>服务端</b>：聊天、邮件、金融、密码类应用会整体匿名化为「私密应用」，窗口标题原文不落盘、不下发到前端。</p>
      <div class="notice">
        <b>统一管理面板：</b>站点名称、离线判定、数据保留天数、设备与令牌增删、清空数据、修改管理密码，都在 <router-link to="/admin" style="color: var(--accent); font-weight: 600">/admin</router-link> 里完成，保存即时生效，无需重启服务。
      </div>
    </section>

    <section class="card guide-section">
      <h2 style="font-size: 16px">在线测试上报</h2>
      <p class="section-note">令牌只保存在本次页面内存里，刷新即清除；测试记录会真的出现在面板上。</p>
      <form class="test-form" @submit.prevent="submitTest">
        <div class="form-row">
          <input v-model="testToken" type="password" autocomplete="off" placeholder="手机令牌（config.json 里的 token）" />
        </div>
        <div class="form-row">
          <input v-model="testAppId" type="text" placeholder="app_id，例如 com.tencent.mm" />
          <input v-model="testAppLabel" type="text" placeholder="应用显示名，例如 微信" />
        </div>
        <div class="form-row">
          <input v-model="testBattery" type="number" min="0" max="100" placeholder="电量 0-100" />
          <button class="primary-btn" type="submit">发送测试上报</button>
        </div>
        <div class="test-result" :class="testResult.cls">{{ testResult.text }}</div>
      </form>
      <div class="notice">
        <b>隐私说明：</b>面板是公开只读的。服务端不会保存窗口标题原文；聊天、邮件、金融、密码类应用会整体匿名化成“私密应用”，只保留使用时长。
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <span>Live Dashboard · 接入指南</span>
    <span class="footer-links">
      <router-link to="/admin">管理面板</router-link>
      <router-link to="/">返回面板</router-link>
    </span>
  </footer>
</template>
