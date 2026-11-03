'use strict';

const state = {
  config: null,
  current: null,
  timeline: null,
  selectedDevice: 'all',
  selectedDate: localDateString(new Date()),
  refreshTimer: null,
  loadingTimeline: false,
};

// ── 通用工具 ───────────────────────────────────────────────────────────
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m === 0) return '不足 1 分钟';
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`;
}

function colorFor(name) {
  let hash = 0;
  const text = String(name || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 64% 58%)`;
}

const PLATFORM_LABEL = {
  windows: 'Windows',
  android: 'Android',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
};

const PLATFORM_ICON = {
  desktop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>`,
};

function platformIcon(platform) {
  return platform === 'android' || platform === 'ios' ? PLATFORM_ICON.phone : PLATFORM_ICON.desktop;
}

async function api(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── 主题 ───────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#131019' : '#fff5f8';
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  document.getElementById('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

// ── 数据加载 ───────────────────────────────────────────────────────────
async function refreshCurrent() {
  try {
    state.current = await api('/api/current');
    renderHeaderCounts();
    renderHero();
    renderDevices();
    renderRecent();
  } catch (err) {
    console.warn('加载当前状态失败', err);
  }
}

async function refreshTimeline() {
  if (state.loadingTimeline) return;
  state.loadingTimeline = true;
  try {
    const tz = new Date().getTimezoneOffset();
    const deviceParam = state.selectedDevice === 'all' ? '' : `&device_id=${encodeURIComponent(state.selectedDevice)}`;
    state.timeline = await api(`/api/timeline?date=${state.selectedDate}&tz=${tz}${deviceParam}`);
    renderTimeline();
  } catch (err) {
    console.warn('加载时间线失败', err);
  } finally {
    state.loadingTimeline = false;
  }
}

function scheduleRefresh() {
  if (state.refreshTimer) return;
  state.refreshTimer = setTimeout(async () => {
    state.refreshTimer = null;
    await refreshCurrent();
    await refreshTimeline();
  }, 800);
}

// ── 渲染：顶栏 ─────────────────────────────────────────────────────────
function renderHeaderCounts() {
  const current = state.current;
  if (!current) return;
  document.getElementById('viewer-count').textContent = current.viewer_count ?? 0;
  const online = current.devices.filter((d) => d.online).length;
  document.getElementById('device-summary').textContent =
    `${current.devices.length} 台设备 · ${online} 台在线`;
}

// ── 渲染：Hero ─────────────────────────────────────────────────────────
function pickFocusDevice() {
  const devices = state.current ? state.current.devices : [];
  const online = devices.filter((d) => d.online && d.app_name);
  if (online.length) {
    return online.sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0];
  }
  const seen = devices.filter((d) => d.last_seen_at);
  if (seen.length) {
    return seen.sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0];
  }
  return null;
}

function renderHero() {
  const focus = pickFocusDevice();
  const heroTitle = document.getElementById('hero-title');
  const heroStatus = document.getElementById('hero-status');
  const heroDetail = document.getElementById('hero-detail');
  const heroDevice = document.getElementById('hero-device');
  const heroUpdated = document.getElementById('hero-updated');

  if (!focus) {
    heroTitle.textContent = '等待第一次上报…';
    heroStatus.innerHTML = '把电脑或手机接上，就能看到实时动态喵~ <a href="/guide">看看怎么接入</a>';
    heroDetail.textContent = '';
    heroDevice.innerHTML = '';
    heroUpdated.textContent = '';
    return;
  }

  const name = esc(focus.device_name);
  const app = esc(focus.app_name || '未知应用');
  heroTitle.innerHTML = `${name} <span class="accent">正在 ${app}</span>`;
  heroStatus.textContent = focus.status_text || '';
  heroDetail.textContent = focus.display_title || (focus.secret ? '（私密应用，不公开内容）' : '');

  heroDevice.innerHTML = `
    <span class="platform-icon" style="width:28px;height:28px;border-radius:9px">${platformIcon(focus.platform)}</span>
    ${name}
    <span class="online-dot" style="margin:0"><i style="background:${focus.online ? 'var(--green)' : '#c4b8c6'}"></i></span>
  `;
  heroUpdated.textContent = focus.last_seen_at
    ? `最后更新 ${formatRelative(focus.last_seen_at)} · ${formatClock(focus.last_seen_at)}`
    : '';
}

// ── 渲染：设备卡片 ─────────────────────────────────────────────────────
function renderDevices() {
  const grid = document.getElementById('device-grid');
  const devices = state.current ? state.current.devices : [];

  if (devices.length === 0) {
    grid.innerHTML = `<div class="card device-card"><p class="empty">还没有配置设备，请编辑 <span class="inline-code">config.json</span>。</p></div>`;
    return;
  }

  grid.innerHTML = devices.map((d) => {
    const extra = d.extra || {};
    const battery = Number(extra.battery_percent);
    const hasBattery = Number.isFinite(battery);
    const charging = extra.battery_charging === true;
    const music = extra.music || null;
    const onlineText = d.online ? '在线' : '离线';
    const lastSeen = d.last_seen_at
      ? (d.online ? `刚刚 · ${formatClock(d.last_seen_at)}` : `${formatRelative(d.last_seen_at)}离线`)
      : '还没有上报';

    return `
      <article class="card device-card ${d.online ? 'is-online' : 'is-offline'}">
        <div class="device-head">
          <div class="platform-icon">${platformIcon(d.platform)}</div>
          <div style="min-width:0">
            <div class="device-name">${esc(d.device_name)}</div>
            <div class="device-platform">${esc(PLATFORM_LABEL[d.platform] || d.platform)}</div>
          </div>
          <span class="online-dot"><i></i>${onlineText}</span>
        </div>
        <div class="device-app">${esc(d.app_name || '还没上报')}</div>
        <p class="device-status">${esc(d.status_text || '等待第一次上报…')}</p>
        <div class="device-title" title="${esc(d.display_title || '')}">${esc(d.display_title || '')}</div>
        <div class="device-foot">
          ${hasBattery ? `
            <span class="battery ${battery <= 20 ? 'low' : ''}">
              <span>${charging ? '⚡' : '🔋'} ${battery}%</span>
              <span class="battery-track"><i style="width:${Math.min(100, Math.max(0, battery))}%"></i></span>
            </span>` : '<span></span>'}
          <span>${esc(lastSeen)}</span>
        </div>
        <div class="music" title="${esc(music ? `${music.title || ''} ${music.artist || ''}` : '')}">${
          music && music.title
            ? `♪ ${esc(music.title)}${music.artist ? ` · ${esc(music.artist)}` : ''}${music.app ? ` · ${esc(music.app)}` : ''}`
            : ''
        }</div>
      </article>
    `;
  }).join('');
}

// ── 渲染：时间线 ───────────────────────────────────────────────────────
function renderDeviceTabs() {
  const tabs = document.getElementById('device-tabs');
  const devices = state.config ? state.config.devices : [];
  const items = [{ id: 'all', name: '全部设备' }, ...devices.map((d) => ({ id: d.id, name: d.name }))];
  tabs.innerHTML = items.map((d) => `
    <button class="device-tab ${state.selectedDevice === d.id ? 'is-active' : ''}" data-device="${esc(d.id)}" type="button" role="tab">
      ${esc(d.name)}
    </button>
  `).join('');

  tabs.querySelectorAll('.device-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDevice = btn.dataset.device;
      renderDeviceTabs();
      refreshTimeline();
    });
  });
}

function renderTimeline() {
  renderDeviceTabs();
  const rows = document.getElementById('timeline-rows');
  const totalEl = document.getElementById('timeline-total');
  const timeline = state.timeline;

  if (!timeline) {
    rows.innerHTML = '<p class="empty">加载中…</p>';
    return;
  }

  const devices = state.config ? state.config.devices : [];
  const visible = state.selectedDevice === 'all'
    ? devices
    : devices.filter((d) => d.id === state.selectedDevice);

  const [y, m, d] = state.selectedDate.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const isToday = state.selectedDate === localDateString(new Date());
  const nowPercent = isToday ? Math.min(100, Math.max(0, ((Date.now() - dayStart) / dayMs) * 100)) : null;

  let totalMinutes = 0;

  rows.innerHTML = visible.map((device) => {
    const segments = timeline.segments.filter((s) => s.device_id === device.id);
    const summary = (timeline.summary && timeline.summary[device.id]) || {};
    totalMinutes += Object.values(summary).reduce((sum, v) => sum + v, 0);

    const bars = segments.map((s) => {
      const start = new Date(s.started_at).getTime();
      let end = s.ended_at ? new Date(s.ended_at).getTime() : start + 60 * 1000;
      if (!Number.isFinite(end) || end <= start) end = start + 60 * 1000;
      const left = Math.max(0, Math.min(100, ((start - dayStart) / dayMs) * 100));
      const width = Math.max(0.18, Math.min(100 - left, ((end - start) / dayMs) * 100));
      const tip = `${s.app_name} · ${formatClock(s.started_at)}–${s.ended_at ? formatClock(s.ended_at) : '…'} · ${formatMinutes(s.duration_minutes)}`;
      return `<span class="timeline-seg" style="left:${left}%;width:${width}%;background:${colorFor(s.app_name)}" title="${esc(tip)}"></span>`;
    }).join('');

    const chips = Object.entries(summary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, minutes]) => `
        <span class="chip"><i style="background:${colorFor(name)}"></i>${esc(name)} ${esc(formatMinutes(minutes))}</span>
      `).join('');

    return `
      <div class="timeline-row">
        <div class="timeline-row-label" title="${esc(device.name)}">${esc(device.name)}</div>
        <div class="timeline-track-wrap">
          <div class="timeline-track">
            ${bars}
            ${nowPercent !== null ? `<span class="timeline-now" style="left:${nowPercent}%"></span>` : ''}
          </div>
          <div class="timeline-axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          <div class="timeline-chips">${chips || '<span class="chip">这一天还没有记录</span>'}</div>
        </div>
      </div>
    `;
  }).join('') || '<p class="empty">还没有设备。</p>';

  totalEl.innerHTML = totalMinutes > 0
    ? `这天共记录 <b>${esc(formatMinutes(totalMinutes))}</b>`
    : '';
}

// ── 渲染：最近动态 ─────────────────────────────────────────────────────
function renderRecent() {
  const list = document.getElementById('recent-list');
  const recent = state.current ? state.current.recent_activities : [];

  if (recent.length === 0) {
    list.innerHTML = `<li class="empty">还没有任何动态。<a href="/guide">让手机开始上报 →</a></li>`;
    return;
  }

  list.innerHTML = recent.map((a) => `
    <li class="recent-item">
      <span class="recent-time">${esc(formatClock(a.started_at))}</span>
      <div class="recent-main">
        <div class="recent-app">${esc(a.app_name)}<span class="sep">·</span>${esc(a.status_text || '')}</div>
        <div class="recent-status">${esc(a.display_title || '')}</div>
      </div>
      <span class="recent-device">${esc(a.device_name)}</span>
    </li>
  `).join('');
}

// ── 实时连接 ───────────────────────────────────────────────────────────
function connectStream() {
  if (!window.EventSource) return;
  const clientId = localStorage.getItem('viewer_id')
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem('viewer_id', clientId);

  const source = new EventSource(`/api/stream?client_id=${encodeURIComponent(clientId)}`);

  const setViewer = (count) => {
    document.getElementById('viewer-count').textContent = count ?? 0;
  };

  source.addEventListener('hello', (event) => {
    try { setViewer(JSON.parse(event.data).viewer_count); } catch { /* ignore */ }
  });

  source.addEventListener('viewers', (event) => {
    try { setViewer(JSON.parse(event.data).viewer_count); } catch { /* ignore */ }
  });

  source.addEventListener('update', () => {
    scheduleRefresh();
  });

  source.addEventListener('error', () => {
    // 浏览器会自动重连；同时保底轮询
  });
}

// ── 启动 ───────────────────────────────────────────────────────────────
async function init() {
  initTheme();

  try {
    state.config = await api('/api/config');
    document.title = `${state.config.site.name} · Live Dashboard`;
    document.getElementById('site-name').textContent = state.config.site.name;
    document.getElementById('site-desc').textContent = state.config.site.description;

    const dateInput = document.getElementById('date-input');
    dateInput.value = state.selectedDate;
    dateInput.max = localDateString(new Date());
    dateInput.addEventListener('change', () => {
      if (!dateInput.value) return;
      state.selectedDate = dateInput.value;
      refreshTimeline();
    });

    renderDeviceTabs();
    await Promise.all([refreshCurrent(), refreshTimeline()]);
  } catch (err) {
    document.getElementById('hero-title').textContent = '服务连接失败';
    document.getElementById('hero-status').textContent = String(err.message || err);
  }

  connectStream();
  setInterval(() => {
    refreshCurrent();
    if (state.selectedDate === localDateString(new Date())) refreshTimeline();
  }, 20000);
}

document.addEventListener('DOMContentLoaded', init);
