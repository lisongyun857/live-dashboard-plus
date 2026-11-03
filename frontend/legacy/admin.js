'use strict';

// ── 主题 ───────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#131019' : '#fff5f8';
  localStorage.setItem('theme', theme);
}
applyTheme(localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.getElementById('theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ── 工具 ───────────────────────────────────────────────────────────────
const TOKEN_KEY = 'ld_admin_token';
const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function setMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('ok', Boolean(ok));
  el.classList.toggle('bad', Boolean(text) && !ok);
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (res.status === 401 && path !== '/api/admin/login') {
    showLogin();
    throw new Error('登录已过期，请重新登录');
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

// ── 登录 ───────────────────────────────────────────────────────────────
function showLogin() {
  $('login-view').hidden = false;
  $('panel-view').hidden = true;
}

function showPanel() {
  $('login-view').hidden = true;
  $('panel-view').hidden = false;
  loadOverview();
}

$('login-form').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const password = $('login-password').value;
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    $('login-password').value = '';
    setMsg('login-msg', '登录成功', true);
    showPanel();
  } catch (err) {
    setMsg('login-msg', err.message, false);
  }
});

if (location.protocol !== 'https:') {
  $('insecure-warn').hidden = false;
}

// ── 站点设置 ───────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const data = await api('/api/admin/overview');
    $('set-name').value = data.site.name || '';
    $('set-desc').value = data.site.description || '';
    $('set-offline').value = data.offline_after_seconds;
    $('set-retention').value = data.retention_days;

    const stats = data.stats;
    $('stat-line').textContent = `${data.devices.length} 台设备 · ${stats.activity_count} 条记录 · 已运行 ${Math.round(data.uptime_seconds / 60)} 分钟`;
    $('data-stats').textContent = `共 ${stats.activity_count} 条记录，数据文件约 ${stats.file_kb} KB` +
      (stats.oldest_at ? `，最早记录 ${new Date(stats.oldest_at).toLocaleString()}` : '');

    renderDevices(data.devices);
  } catch (err) {
    setMsg('settings-msg', err.message, false);
  }
}

$('save-settings').addEventListener('click', async () => {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        name: $('set-name').value.trim(),
        description: $('set-desc').value.trim(),
        offline_after_seconds: Number($('set-offline').value),
        retention_days: Number($('set-retention').value),
      }),
    });
    setMsg('settings-msg', '已保存并生效', true);
    loadOverview();
  } catch (err) {
    setMsg('settings-msg', err.message, false);
  }
});

// ── 设备管理 ───────────────────────────────────────────────────────────
function deviceSnippets(device) {
  const url = `${location.origin}/api/report`;
  return {
    url,
    macroJson: JSON.stringify({
      app_id: '{app_package}',
      app_name: '{app_name}',
      battery_percent: '{battery}',
    }),
    curl: `curl -X POST "${url}" -H "Authorization: Bearer ${device.token}" -H "Content-Type: application/json" -d '{"app_id":"com.example.app","app_name":"示例应用"}'`,
    agent: `powershell -ExecutionPolicy Bypass -File agent\\pc-agent.ps1 -ServerUrl ${url} -Token ${device.token}`,
  };
}

function renderDevices(devices) {
  const list = $('device-list');
  if (!devices.length) {
    list.innerHTML = '<p class="admin-muted">还没有设备，先在上面添加一台。</p>';
    return;
  }
  list.innerHTML = devices.map((d) => {
    const snip = deviceSnippets(d);
    return `
    <div class="device-admin" data-id="${esc(d.id)}">
      <div class="device-admin-row">
        <input class="admin-input da-name" value="${esc(d.name)}" maxlength="32" aria-label="设备名称">
        <select class="admin-select da-platform" aria-label="平台">
          ${['windows', 'android', 'macos', 'linux', 'ios'].map((p) =>
            `<option value="${p}" ${p === d.platform ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <button class="admin-btn da-save" type="button">保存修改</button>
        <button class="admin-btn da-token" type="button">重新生成令牌</button>
        <button class="admin-btn danger da-delete" type="button">删除</button>
      </div>
      <div class="device-admin-token">
        <span class="da-label">令牌</span>
        <code class="da-token-value">${esc(d.token)}</code>
        <button class="admin-btn small da-copy-token" type="button">复制</button>
      </div>
      <details class="snippet">
        <summary>接入代码片段</summary>
        <div class="snippet-block"><span>上报地址</span><code>${esc(snip.url)}</code><button class="admin-btn small da-copy" data-copy="${esc(snip.url)}" type="button">复制</button></div>
        <div class="snippet-block"><span>MacroDroid 请求体</span><code>${esc(snip.macroJson)}</code><button class="admin-btn small da-copy" data-copy="${esc(snip.macroJson)}" type="button">复制</button></div>
        <div class="snippet-block"><span>curl 测试</span><code>${esc(snip.curl)}</code><button class="admin-btn small da-copy" data-copy="${esc(snip.curl)}" type="button">复制</button></div>
        <div class="snippet-block"><span>电脑 agent 启动命令</span><code>${esc(snip.agent)}</code><button class="admin-btn small da-copy" data-copy="${esc(snip.agent)}" type="button">复制</button></div>
      </details>
    </div>`;
  }).join('');
}

$('add-device').addEventListener('click', async () => {
  try {
    await api('/api/admin/devices', {
      method: 'POST',
      body: JSON.stringify({
        name: $('new-device-name').value.trim(),
        platform: $('new-device-platform').value,
      }),
    });
    $('new-device-name').value = '';
    setMsg('device-msg', '设备已添加', true);
    loadOverview();
  } catch (err) {
    setMsg('device-msg', err.message, false);
  }
});

$('device-list').addEventListener('click', async (evt) => {
  const btn = evt.target.closest('button');
  if (!btn) return;
  const card = evt.target.closest('.device-admin');
  const id = card && card.dataset.id;
  if (!id) return;

  if (btn.classList.contains('da-copy')) {
    const ok = await copyText(btn.dataset.copy || '');
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { btn.textContent = '复制'; }, 1200);
    return;
  }
  if (btn.classList.contains('da-copy-token')) {
    const token = card.querySelector('.da-token-value').textContent;
    const ok = await copyText(token);
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { btn.textContent = '复制'; }, 1200);
    return;
  }
  if (btn.classList.contains('da-save')) {
    try {
      await api('/api/admin/devices/update', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name: card.querySelector('.da-name').value.trim(),
          platform: card.querySelector('.da-platform').value,
        }),
      });
      setMsg('device-msg', '设备已更新', true);
      loadOverview();
    } catch (err) {
      setMsg('device-msg', err.message, false);
    }
    return;
  }
  if (btn.classList.contains('da-token')) {
    if (!confirm('重新生成令牌后，该设备旧令牌立即失效，需要更新设备上的配置。继续？')) return;
    try {
      await api('/api/admin/devices/token', { method: 'POST', body: JSON.stringify({ id }) });
      setMsg('device-msg', '令牌已重新生成，记得更新设备配置', true);
      loadOverview();
    } catch (err) {
      setMsg('device-msg', err.message, false);
    }
    return;
  }
  if (btn.classList.contains('da-delete')) {
    if (!confirm('删除设备会同时清掉它的全部历史记录，且该设备令牌失效。确定删除？')) return;
    try {
      await api('/api/admin/devices/delete', { method: 'POST', body: JSON.stringify({ id }) });
      setMsg('device-msg', '设备已删除', true);
      loadOverview();
    } catch (err) {
      setMsg('device-msg', err.message, false);
    }
  }
});

// ── 数据管理 ───────────────────────────────────────────────────────────
$('clear-all').addEventListener('click', async () => {
  if (!confirm('将清空所有设备的历史记录（不影响设备配置）。确定？')) return;
  try {
    const data = await api('/api/admin/data/clear', { method: 'POST', body: JSON.stringify({}) });
    setMsg('data-msg', `已清空，现在剩余 ${data.stats.activity_count} 条`, true);
    loadOverview();
  } catch (err) {
    setMsg('data-msg', err.message, false);
  }
});

// ── 修改密码 ───────────────────────────────────────────────────────────
$('save-password').addEventListener('click', async () => {
  const password = $('new-password').value;
  if (password.length < 6) {
    setMsg('password-msg', '密码至少 6 位', false);
    return;
  }
  try {
    const data = await api('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    $('new-password').value = '';
    setMsg('password-msg', '密码已更新', true);
  } catch (err) {
    setMsg('password-msg', err.message, false);
  }
});

// ── 初始化 ─────────────────────────────────────────────────────────────
if (localStorage.getItem(TOKEN_KEY)) {
  showPanel();
} else {
  showLogin();
  $('login-password').focus();
}
