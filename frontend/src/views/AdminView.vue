<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, copyText, localDateString, toggleTheme, PLATFORM_OPTIONS, ICON_MOON, ICON_SUN, API_BASE } from '../lib/ui';

const TOKEN_KEY = 'ld_admin_token';
const token = ref(localStorage.getItem(TOKEN_KEY) || '');
const loggedIn = ref(Boolean(token.value));
const insecure = ref(location.protocol !== 'https:' || /^http:/i.test(API_BASE));

const loginPassword = ref('');
const msgs = ref({}); // key -> { text, ok }

function setMsg(key, text, ok = false) {
  msgs.value[key] = { text, ok };
  if (text) {
    setTimeout(() => {
      if (msgs.value[key] && msgs.value[key].text === text) msgs.value[key] = { text: '', ok };
    }, 4000);
  }
}

async function adminApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token.value) headers.Authorization = `Bearer ${token.value}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // 空响应
  }
  if (res.status === 401 && path !== '/api/admin/login') {
    loggedIn.value = false;
    token.value = '';
    localStorage.removeItem(TOKEN_KEY);
    throw new Error('登录已过期，请重新登录');
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

// ── 登录 ───────────────────────────────────────────────────────────────
async function doLogin() {
  try {
    const data = await adminApi('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: loginPassword.value }),
    });
    token.value = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    loginPassword.value = '';
    setMsg('login', '登录成功', true);
    await loadOverview();
    loggedIn.value = true;
  } catch (err) {
    setMsg('login', err.message, false);
  }
}

// ── 站点设置 / 概览 ────────────────────────────────────────────────────
const siteName = ref('');
const siteDesc = ref('');
const offlineSeconds = ref(120);
const retentionDays = ref(7);
const statLine = ref('');
const dataStats = ref('');
const deviceList = ref([]);

// ── AI 总结设置 ────────────────────────────────────────────────────────
const aiForm = ref({
  enabled: false,
  protocol: 'openai',
  api_key: '',
  base_url: '',
  model: '',
  temperature: 0.4,
  max_tokens: 600,
  cache_minutes: 30,
});
const aiProtocols = ref([]);
const aiTesting = ref(false);

const aiHint = computed(() => {
  const item = aiProtocols.value.find((p) => p.key === aiForm.value.protocol);
  return item ? item.hint : '';
});

async function saveAi() {
  try {
    await adminApi('/api/admin/ai', {
      method: 'POST',
      body: JSON.stringify({ ai: aiForm.value }),
    });
    setMsg('ai', '已保存，仪表盘会立即生效', true);
    loadOverview();
  } catch (err) {
    setMsg('ai', err.message, false);
  }
}

async function testAi() {
  if (aiTesting.value) return;
  aiTesting.value = true;
  setMsg('ai', '正在连接模型…', true);
  try {
    const data = await adminApi('/api/admin/ai/test', {
      method: 'POST',
      body: JSON.stringify({ ai: aiForm.value }),
    });
    if (data.ok) {
      setMsg('ai', `连接正常（${data.latency_ms} ms）：${data.reply || '已返回内容'}`, true);
    } else {
      setMsg('ai', `连接失败：${data.error}`, false);
    }
  } catch (err) {
    setMsg('ai', err.message, false);
  } finally {
    aiTesting.value = false;
  }
}

async function loadOverview() {
  try {
    const data = await adminApi('/api/admin/overview');
    siteName.value = data.site.name || '';
    siteDesc.value = data.site.description || '';
    offlineSeconds.value = data.offline_after_seconds;
    retentionDays.value = data.retention_days;

    const stats = data.stats;
    statLine.value = `${data.devices.length} 台设备 · ${stats.activity_count} 条记录 · 已运行 ${Math.round(data.uptime_seconds / 60)} 分钟`;
    dataStats.value =
      `共 ${stats.activity_count} 条记录，数据文件约 ${stats.file_kb} KB` +
      (stats.oldest_at ? `，最早记录 ${new Date(stats.oldest_at).toLocaleString()}` : '');
    deviceList.value = data.devices;
    aiProtocols.value = data.ai_protocols || [];
    if (data.ai) aiForm.value = { ...data.ai };
  } catch (err) {
    setMsg('settings', err.message, false);
  }
}

async function saveSettings() {
  try {
    await adminApi('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        name: siteName.value.trim(),
        description: siteDesc.value.trim(),
        offline_after_seconds: Number(offlineSeconds.value),
        retention_days: Number(retentionDays.value),
      }),
    });
    setMsg('settings', '已保存并生效', true);
    loadOverview();
  } catch (err) {
    setMsg('settings', err.message, false);
  }
}

// ── 设备管理 ───────────────────────────────────────────────────────────
const newDeviceName = ref('');
const newDevicePlatform = ref('windows');

function deviceSnippets(device) {
  // 前后端不同域名时必须用后端 API 域名，不能取前端页面的 origin
  const url = `${API_BASE || location.origin}/api/report`;
  return {
    url,
    macroJson: JSON.stringify({
      app_id: '{app_package}',
      app_label: '{app_name}',
      battery_percent: '{battery}',
    }),
    curl: `curl -X POST "${url}" -H "Authorization: Bearer ${device.token}" -H "Content-Type: application/json" -d '{"app_id":"com.example.app","app_name":"示例应用"}'`,
    agent: `powershell -ExecutionPolicy Bypass -File agent\\pc-agent.ps1 -ServerUrl ${url} -Token ${device.token}`,
  };
}

const copiedKey = ref('');

async function copy(key, text) {
  const ok = await copyText(text);
  copiedKey.value = ok ? key : '';
  if (ok) setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = '';
  }, 1200);
  return ok;
}

async function addDevice() {
  try {
    await adminApi('/api/admin/devices', {
      method: 'POST',
      body: JSON.stringify({ name: newDeviceName.value.trim(), platform: newDevicePlatform.value }),
    });
    newDeviceName.value = '';
    setMsg('device', '设备已添加', true);
    loadOverview();
  } catch (err) {
    setMsg('device', err.message, false);
  }
}

async function saveDevice(device) {
  try {
    await adminApi('/api/admin/devices/update', {
      method: 'POST',
      body: JSON.stringify({
        id: device.id,
        name: device.name.trim(),
        platform: device.platform,
        allow_commands: Boolean(device.allow_commands),
      }),
    });
    setMsg('device', '设备已更新', true);
    loadOverview();
  } catch (err) {
    setMsg('device', err.message, false);
  }
}

async function regenToken(device) {
  if (!window.confirm('重新生成令牌后，该设备旧令牌立即失效，需要更新设备上的配置。继续？')) return;
  try {
    await adminApi('/api/admin/devices/token', { method: 'POST', body: JSON.stringify({ id: device.id }) });
    setMsg('device', '令牌已重新生成，记得更新设备配置', true);
    loadOverview();
  } catch (err) {
    setMsg('device', err.message, false);
  }
}

async function deleteDevice(device) {
  if (!window.confirm('删除设备会同时清掉它的全部历史记录，且该设备令牌失效。确定删除？')) return;
  try {
    await adminApi('/api/admin/devices/delete', { method: 'POST', body: JSON.stringify({ id: device.id }) });
    setMsg('device', '设备已删除', true);
    loadOverview();
  } catch (err) {
    setMsg('device', err.message, false);
  }
}

// ── 数据管理 ───────────────────────────────────────────────────────────
const exportDate = ref(localDateString(new Date()));

function exportUrl(format) {
  const tz = new Date().getTimezoneOffset();
  return `${API_BASE}/api/export?date=${exportDate.value}&tz=${tz}&format=${format}`;
}

async function clearAll() {
  if (!window.confirm('将清空所有设备的历史记录（不影响设备配置）。确定？')) return;
  try {
    const data = await adminApi('/api/admin/data/clear', { method: 'POST', body: JSON.stringify({}) });
    setMsg('data', `已清空，现在剩余 ${data.stats.activity_count} 条`, true);
    loadOverview();
  } catch (err) {
    setMsg('data', err.message, false);
  }
}

// ── 修改密码 ───────────────────────────────────────────────────────────
const newPassword = ref('');

async function savePassword() {
  const password = newPassword.value;
  if (password.length < 6) {
    setMsg('password', '密码至少 6 位', false);
    return;
  }
  try {
    const data = await adminApi('/api/admin/password', { method: 'POST', body: JSON.stringify({ password }) });
    token.value = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    newPassword.value = '';
    setMsg('password', '密码已更新', true);
  } catch (err) {
    setMsg('password', err.message, false);
  }
}

onMounted(() => {
  document.title = '管理面板 · Live Dashboard';
  if (loggedIn.value) loadOverview();
});
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
            />
          </svg>
        </div>
        <div class="brand-text">
          <h1>管理面板</h1>
          <p class="brand-sub">站点 · 设备 · 数据 · 安全</p>
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

  <main class="page admin-page">
    <!-- 登录 -->
    <section class="card admin-login" v-if="!loggedIn">
      <h2>管理员登录</h2>
      <p class="admin-muted">密码在第一次启动服务时自动生成并打印在控制台，也可在 config.json 的 admin_password 查看。</p>
      <form autocomplete="off" @submit.prevent="doLogin">
        <label class="field">
          <span>管理密码</span>
          <input class="admin-input" v-model="loginPassword" type="password" placeholder="输入管理密码" required />
        </label>
        <button class="admin-btn primary" type="submit">登录</button>
      </form>
      <p class="admin-msg" :class="{ ok: msgs.login && msgs.login.ok, bad: msgs.login && !msgs.login.ok }">{{ msgs.login ? msgs.login.text : '' }}</p>
      <p class="admin-warn" v-if="insecure">当前通过 HTTP 明文访问，密码可能被窃听。建议先给服务器配置 HTTPS（见接入指南的部署章节）。</p>
    </section>

    <!-- 面板主体 -->
    <template v-else>
      <section class="card admin-card">
        <div class="section-head">
          <h2>站点设置</h2>
          <span class="section-note">{{ statLine }}</span>
        </div>
        <div class="admin-grid">
          <label class="field">
            <span>站点名称</span>
            <input class="admin-input" v-model="siteName" maxlength="64" />
          </label>
          <label class="field">
            <span>站点描述</span>
            <input class="admin-input" v-model="siteDesc" maxlength="128" />
          </label>
          <label class="field">
            <span>离线判定（秒）</span>
            <input class="admin-input" v-model="offlineSeconds" type="number" min="10" max="3600" />
          </label>
          <label class="field">
            <span>记录保留（天）</span>
            <input class="admin-input" v-model="retentionDays" type="number" min="1" max="365" />
          </label>
        </div>
        <div class="admin-actions">
          <button class="admin-btn primary" type="button" @click="saveSettings">保存设置</button>
          <span class="admin-msg" :class="{ ok: msgs.settings && msgs.settings.ok, bad: msgs.settings && !msgs.settings.ok }">{{ msgs.settings ? msgs.settings.text : '' }}</span>
        </div>
      </section>

      <section class="card admin-card">
        <div class="section-head">
          <h2>设备管理</h2>
          <span class="section-note">令牌即设备上报凭据，泄露后请立即重新生成</span>
        </div>
        <div class="admin-inline-form">
          <input class="admin-input" v-model="newDeviceName" placeholder="设备名称，如：我的笔记本" maxlength="32" />
          <select class="admin-select" v-model="newDevicePlatform">
            <option v-for="p in PLATFORM_OPTIONS" :key="p" :value="p">{{ p }}</option>
          </select>
          <button class="admin-btn" type="button" @click="addDevice">添加设备</button>
        </div>
        <p class="admin-msg" :class="{ ok: msgs.device && msgs.device.ok, bad: msgs.device && !msgs.device.ok }">{{ msgs.device ? msgs.device.text : '' }}</p>
        <div class="device-admin-list">
          <p class="admin-muted" v-if="!deviceList.length">还没有设备，先在上面添加一台。</p>
          <div class="device-admin" v-for="d in deviceList" :key="d.id">
            <div class="device-admin-row">
              <input class="admin-input da-name" v-model="d.name" maxlength="32" aria-label="设备名称" />
              <select class="admin-select da-platform" v-model="d.platform" aria-label="平台">
                <option v-for="p in PLATFORM_OPTIONS" :key="p" :value="p">{{ p }}</option>
              </select>
              <button class="admin-btn da-save" type="button" @click="saveDevice(d)">保存修改</button>
              <button class="admin-btn da-token" type="button" @click="regenToken(d)">重新生成令牌</button>
              <button class="admin-btn danger da-delete" type="button" @click="deleteDevice(d)">删除</button>
            </div>
            <div class="device-admin-token">
              <span class="da-label">令牌</span>
              <code class="da-token-value">{{ d.token }}</code>
              <button class="admin-btn small" type="button" @click="copy(`token-${d.id}`, d.token)">
                {{ copiedKey === `token-${d.id}` ? '已复制' : '复制' }}
              </button>
            </div>
            <label class="device-admin-perm" :title="'开启后观众可以在仪表盘请求截屏；电脑端配置界面也要勾选「允许观众发指令」'">
              <input type="checkbox" v-model="d.allow_commands" />
              允许观众发指令（远程截屏，需点「保存修改」生效）
            </label>
            <details class="snippet">
              <summary>接入代码片段</summary>
              <div class="snippet-block" v-for="(value, key) in deviceSnippets(d)" :key="key">
                <span>{{ { url: '上报地址', macroJson: 'MacroDroid 请求体', curl: 'curl 测试', agent: '电脑 agent 启动命令' }[key] }}</span>
                <code>{{ value }}</code>
                <button class="admin-btn small" type="button" @click="copy(`snip-${d.id}-${key}`, value)">
                  {{ copiedKey === `snip-${d.id}-${key}` ? '已复制' : '复制' }}
                </button>
              </div>
            </details>
          </div>
        </div>
      </section>

      <section class="card admin-card">
        <div class="section-head">
          <h2>AI 总结</h2>
          <span class="section-note">API 地址自己填，选择兼容的接口协议即可，支持主流兼容接口</span>
        </div>
        <div class="ai-form">
          <label class="field">
            <span>启用 AI 总结</span>
            <select class="admin-select" v-model="aiForm.enabled">
              <option :value="false">关闭</option>
              <option :value="true">开启</option>
            </select>
          </label>
          <label class="field">
            <span>接口协议（兼容类型）</span>
            <select class="admin-select" v-model="aiForm.protocol">
              <option v-for="p in aiProtocols" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
          </label>
          <label class="field field-wide">
            <span>API 地址（Base URL）</span>
            <input class="admin-input" v-model="aiForm.base_url" placeholder="例如 https://api.deepseek.com/v1" />
          </label>
          <label class="field">
            <span>模型名称</span>
            <input class="admin-input" v-model="aiForm.model" placeholder="例如 deepseek-chat" />
          </label>
          <label class="field">
            <span>API Key</span>
            <input class="admin-input" v-model="aiForm.api_key" type="password" placeholder="本地 Ollama 可留空" autocomplete="off" />
          </label>
          <label class="field">
            <span>温度（0–2）</span>
            <input class="admin-input" v-model.number="aiForm.temperature" type="number" step="0.1" min="0" max="2" />
          </label>
          <label class="field">
            <span>最大输出 tokens</span>
            <input class="admin-input" v-model.number="aiForm.max_tokens" type="number" min="50" max="4000" />
          </label>
          <label class="field">
            <span>结果缓存（分钟，0 不缓存）</span>
            <input class="admin-input" v-model.number="aiForm.cache_minutes" type="number" min="0" max="1440" />
          </label>
          <p class="ai-hint" v-if="aiHint">{{ aiHint }}</p>
        </div>
        <div class="admin-actions">
          <button class="admin-btn primary" type="button" @click="saveAi">保存 AI 设置</button>
          <button class="admin-btn" type="button" :disabled="aiTesting" @click="testAi">{{ aiTesting ? '测试中…' : '测试连接' }}</button>
          <span class="admin-msg" :class="{ ok: msgs.ai && msgs.ai.ok, bad: msgs.ai && !msgs.ai.ok }">{{ msgs.ai ? msgs.ai.text : '' }}</span>
        </div>
      </section>

      <section class="card admin-card">
        <div class="section-head">
          <h2>数据管理</h2>
          <span class="section-note">{{ dataStats }}</span>
        </div>
        <div class="admin-inline-form" style="margin-bottom: 12px">
          <input class="admin-input" type="date" v-model="exportDate" :max="localDateString(new Date())" aria-label="导出日期">
          <a class="admin-btn" :href="exportUrl('csv')" style="text-decoration: none; display: inline-grid; place-items: center">导出 CSV</a>
          <a class="admin-btn" :href="exportUrl('json')" style="text-decoration: none; display: inline-grid; place-items: center">导出 JSON</a>
        </div>
        <div class="admin-actions">
          <button class="admin-btn danger" type="button" @click="clearAll">清空全部历史记录</button>
          <span class="admin-msg" :class="{ ok: msgs.data && msgs.data.ok, bad: msgs.data && !msgs.data.ok }">{{ msgs.data ? msgs.data.text : '' }}</span>
        </div>
      </section>

      <section class="card admin-card">
        <div class="section-head">
          <h2>修改管理密码</h2>
          <span class="section-note">修改后其他已登录会话将失效</span>
        </div>
        <div class="admin-inline-form">
          <input class="admin-input" v-model="newPassword" type="password" placeholder="新密码（至少 6 位）" maxlength="128" />
          <button class="admin-btn" type="button" @click="savePassword">保存新密码</button>
        </div>
        <p class="admin-msg" :class="{ ok: msgs.password && msgs.password.ok, bad: msgs.password && !msgs.password.ok }">{{ msgs.password ? msgs.password.text : '' }}</p>
      </section>
    </template>
  </main>

  <footer class="site-footer">
    <span>Live Dashboard 管理面板</span>
    <span class="footer-links">
      <router-link to="/">查看仪表盘</router-link>
      <router-link to="/guide">接入指南</router-link>
    </span>
  </footer>
</template>
