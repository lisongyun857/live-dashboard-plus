<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, colorFor, formatClock, formatMinutes, formatRelative, localDateString, platformIcon, PLATFORM_LABEL, toggleTheme, ICON_MOON, ICON_SUN, API_BASE } from '../lib/ui';

const config = ref(null);
const current = ref(null);
const timeline = ref(null);
const viewerCount = ref(null);
const selectedDevice = ref('all');
const selectedDate = ref(localDateString(new Date()));
const todayString = ref(localDateString(new Date()));
const loadError = ref('');
const loadingTimeline = ref(false);
const notifyOn = ref(false);
const screenshots = ref([]);
const stats = ref(null);
const heatmap = ref(null);
const aiSummary = ref(null);
const aiLoading = ref(false);
const myCommand = ref(null);
const commandBusy = ref(false);
const commandDeviceId = ref('');
const shotPreview = ref(null);
let prevOnline = null; // Map<device_id, online>，用于检测掉线

let refreshTimer = null;
let pollTimer = null;
let commandPollTimer = null;
let commandPollAlive = true;
let source = null;

const devices = computed(() => (current.value ? current.value.devices : []));
const onlineCount = computed(() => devices.value.filter((d) => d.online).length);
const recent = computed(() => (current.value ? current.value.recent_activities : []));
const viewerShown = computed(() => viewerCount.value ?? (current.value ? current.value.viewer_count : 0));
const siteName = computed(() => (config.value ? config.value.site.name : 'Live Dashboard'));
const siteDesc = computed(() => (config.value ? config.value.site.description : '此刻，我正在做什么'));
const deviceTabs = computed(() => {
  const list = config.value ? config.value.devices : [];
  return [{ id: 'all', name: '全部设备' }, ...list.map((d) => ({ id: d.id, name: d.name }))];
});

function pickFocusDevice() {
  const list = devices.value;
  const online = list.filter((d) => d.online && d.app_name);
  if (online.length) {
    return [...online].sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0];
  }
  const seen = list.filter((d) => d.last_seen_at);
  if (seen.length) {
    return [...seen].sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0];
  }
  return null;
}

const focus = computed(() => pickFocusDevice());

const focusUpdated = computed(() => {
  if (!focus.value || !focus.value.last_seen_at) return '';
  return `最后更新 ${formatRelative(focus.value.last_seen_at)} · ${formatClock(focus.value.last_seen_at)}`;
});

const focusBattery = computed(() => {
  const raw = focus.value && focus.value.extra ? Number(focus.value.extra.battery_percent) : NaN;
  return Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : null;
});

const focusCharging = computed(() => Boolean(focus.value && focus.value.extra && focus.value.extra.battery_charging));

// ── 时间线行：每台设备一条轨道 ─────────────────────────────────────────
const timelineRows = computed(() => {
  const empty = { rows: [], totalMinutes: 0, hasData: false };
  if (!timeline.value) return empty;
  const list = config.value ? config.value.devices : [];
  const visible = selectedDevice.value === 'all' ? list : list.filter((d) => d.id === selectedDevice.value);
  const [y, m, d] = selectedDate.value.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const isToday = selectedDate.value === todayString.value;

  let totalMinutes = 0;
  const rows = visible.map((device) => {
    const segments = timeline.value.segments.filter((s) => s.device_id === device.id);
    const summary = (timeline.value.summary && timeline.value.summary[device.id]) || {};
    totalMinutes += Object.values(summary).reduce((sum, v) => sum + v, 0);

    const bars = segments.map((s) => {
      const start = new Date(s.started_at).getTime();
      let end = s.ended_at ? new Date(s.ended_at).getTime() : start + 60 * 1000;
      if (!Number.isFinite(end) || end <= start) end = start + 60 * 1000;
      const left = Math.max(0, Math.min(100, ((start - dayStart) / dayMs) * 100));
      const width = Math.max(0.18, Math.min(100 - left, ((end - start) / dayMs) * 100));
      const sleeping = s.screen_on === false;
      const span = `${formatClock(s.started_at)}–${s.ended_at ? formatClock(s.ended_at) : '…'}`;
      const tip = sleeping
        ? `息屏 · ${span} · 不计时`
        : `${s.app_name} · ${span} · ${formatMinutes(s.duration_minutes)}`;
      return { left, width, color: sleeping ? 'rgba(140, 140, 155, 0.42)' : colorFor(s.app_name), tip };
    });

    const chips = Object.entries(summary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, minutes]) => ({ name, minutes, color: colorFor(name), text: formatMinutes(minutes) }));

    return {
      id: device.id,
      name: device.name,
      bars,
      chips,
      nowPercent: isToday ? Math.min(100, Math.max(0, ((Date.now() - dayStart) / dayMs) * 100)) : null,
    };
  });

  return { rows, totalMinutes, hasData: totalMinutes > 0 };
});

const timelineTotal = computed(() => {
  if (!timelineRows.value || !timelineRows.value.hasData) return '';
  return `这天共记录 ${formatMinutes(timelineRows.value.totalMinutes)}`;
});

// ── 统计卡片：电量曲线 / 应用排行 / 热力图 / AI 总结 ───────────────────
const statsQuery = computed(() => {
  const tz = new Date().getTimezoneOffset();
  const device = selectedDevice.value === 'all' ? '' : `&device_id=${encodeURIComponent(selectedDevice.value)}`;
  return `date=${selectedDate.value}&tz=${tz}${device}`;
});

const ranking = computed(() => (stats.value && stats.value.ranking ? stats.value.ranking.slice(0, 8) : []));
const rankingMax = computed(() => Math.max(1, ...ranking.value.map((item) => item.minutes)));

const batteryChart = computed(() => {
  const b = stats.value ? stats.value.battery : null;
  if (!b || !b.samples || !b.samples.length) return null;
  const [y, m, d] = selectedDate.value.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const points = b.samples.map((s) => {
    const t = Date.parse(s.t);
    const x = Math.max(0, Math.min(100, ((t - dayStart) / dayMs) * 100));
    const yPos = 100 - Math.max(0, Math.min(100, Number(s.percent)));
    return `${x.toFixed(1)},${yPos.toFixed(1)}`;
  });
  // 只有一个采样点时画不出线，复制一个让它可见
  if (points.length === 1) points.push(points[0]);

  const charging = (b.charging || []).map((seg) => {
    const start = Math.max(dayStart, Date.parse(seg.started_at));
    const end = Math.min(dayStart + dayMs, seg.ended_at ? Date.parse(seg.ended_at) : Date.now());
    const left = Math.max(0, Math.min(100, ((start - dayStart) / dayMs) * 100));
    const width = Math.max(0.5, Math.min(100 - left, ((end - start) / dayMs) * 100));
    return { left, width };
  });

  return {
    points: points.join(' '),
    charging,
    deviceName: b.device_name,
    min: b.min_percent,
    max: b.max_percent,
    start: b.start_percent,
    end: b.end_percent,
    chargingMinutes: b.charging_minutes,
  };
});

function heatLevel(minutes) {
  if (!minutes) return 0;
  if (minutes < 30) return 1;
  if (minutes < 90) return 2;
  if (minutes < 180) return 3;
  return 4;
}

const heatmapCells = computed(() => {
  const items = heatmap.value && Array.isArray(heatmap.value.items) ? heatmap.value.items : [];
  if (!items.length) return [];
  const first = new Date(`${items[0].date}T00:00:00`);
  const pad = Number.isNaN(first.getTime()) ? 0 : first.getDay();
  const cells = [];
  for (let i = 0; i < pad; i += 1) cells.push({ key: `pad-${i}`, empty: true });
  for (const item of items) {
    cells.push({
      key: item.date,
      empty: false,
      level: heatLevel(item.minutes),
      label: `${item.date} · ${formatMinutes(item.minutes)}`,
    });
  }
  return cells;
});

const heatmapTotal = computed(() => (heatmap.value ? formatMinutes(heatmap.value.total_minutes) : ''));

const aiEnabled = computed(() => Boolean(aiSummary.value && aiSummary.value.enabled));
const aiError = computed(() => (aiSummary.value && aiSummary.value.error ? aiSummary.value.error : ''));
const aiLines = computed(() => {
  const text = aiSummary.value && aiSummary.value.summary ? aiSummary.value.summary : '';
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
});

async function refreshStats() {
  try {
    const tz = new Date().getTimezoneOffset();
    const device = selectedDevice.value === 'all' ? '' : `&device_id=${encodeURIComponent(selectedDevice.value)}`;
    const [s, h] = await Promise.all([
      api(`/api/stats?${statsQuery.value}`),
      api(`/api/heatmap?date=${todayString.value}&days=90&tz=${tz}${device}`),
    ]);
    stats.value = s;
    heatmap.value = h;
  } catch (err) {
    console.warn('加载统计失败', err);
  }
}

async function refreshAi(force = false) {
  if (aiLoading.value) return;
  aiLoading.value = true;
  try {
    const extra = force ? '&force=1' : '';
    aiSummary.value = await api(`/api/ai/summary?${statsQuery.value}${extra}`);
  } catch (err) {
    aiSummary.value = { enabled: true, summary: '', error: String(err.message || err) };
  } finally {
    aiLoading.value = false;
  }
}

function lastSeenText(d) {
  if (!d.last_seen_at) return '还没有上报';
  return d.online ? `刚刚 · ${formatClock(d.last_seen_at)}` : `${formatRelative(d.last_seen_at)}离线`;
}

// ── 远程截屏：只对开启了「允许观众发指令」的电脑生效 ────────────────────
function allowsCommands(deviceId) {
  const d = config.value ? config.value.devices.find((x) => x.id === deviceId) : null;
  return Boolean(d && d.allow_commands);
}

const commandDevices = computed(() =>
  devices.value.filter((d) => d.platform === 'windows' && allowsCommands(d.device_id))
);
const commandDevice = computed(
  () => commandDevices.value.find((d) => d.device_id === commandDeviceId.value) || commandDevices.value[0] || null
);
const commandOnline = computed(() => Boolean(commandDevice.value && commandDevice.value.online));
const latestShot = computed(() => (screenshots.value.length ? screenshots.value[0] : null));
const olderShots = computed(() => screenshots.value.slice(1));

const shotStatus = computed(() => {
  const c = myCommand.value;
  if (!c) return '';
  if (c.status === 'pending') {
    if (c.acked_at) return '电脑已收到，等待它同意…';
    if (c.queue_position > 1) return `已排队，前面还有 ${c.queue_position - 1} 条请求`;
    return '已发给电脑，等待它确认…';
  }
  if (c.status === 'approved') return '截屏成功';
  if (c.status === 'rejected') return c.error || '电脑拒绝了请求';
  if (c.status === 'timeout') return c.error || '电脑 20 秒内没有处理，已自动拒绝';
  return c.error || '请求失败';
});

const shotStatusClass = computed(() => {
  const c = myCommand.value;
  if (!c) return '';
  if (c.status === 'approved') return 'ok';
  if (c.status === 'pending') return 'pending';
  return 'bad';
});

function shotUrl(shot) {
  return shot && shot.url ? `${API_BASE}${shot.url}` : '';
}

function formatShotTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false });
}

async function refreshScreenshots() {
  try {
    const data = await api('/api/screenshots?limit=20');
    screenshots.value = data.screenshots || [];
  } catch (err) {
    console.warn('加载截图失败', err);
  }
}

async function requestScreenshot() {
  const device = commandDevice.value;
  if (!device || commandBusy.value) return;
  commandBusy.value = true;
  myCommand.value = null;
  commandDeviceId.value = device.device_id;
  try {
    const data = await api('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: device.device_id, kind: 'screenshot' }),
    });
    myCommand.value = data.command;
    scheduleCommandPoll();
  } catch (err) {
    myCommand.value = { status: 'failed', error: String(err.message || err) };
  } finally {
    commandBusy.value = false;
  }
}

// SSE 之外的兜底：指令还在排队时每 1.5 秒查一次状态
function scheduleCommandPoll() {
  if (!commandPollAlive) return;
  if (commandPollTimer) clearTimeout(commandPollTimer);
  commandPollTimer = setTimeout(async () => {
    commandPollTimer = null;
    const c = myCommand.value;
    if (!c || !c.id || c.status !== 'pending') return;
    try {
      const data = await api(`/api/command/${encodeURIComponent(c.id)}`);
      if (myCommand.value && myCommand.value.id === c.id) myCommand.value = data.command;
    } catch {
      // 网络抖动就等下一轮
    }
    scheduleCommandPoll();
  }, 1500);
}

// ── 数据加载 ───────────────────────────────────────────────────────────
async function refreshCurrent() {
  try {
    current.value = await api('/api/current');
    loadError.value = '';
    checkOffline(current.value.devices);
  } catch (err) {
    loadError.value = String(err.message || err);
  }
}

async function refreshTimeline() {
  if (loadingTimeline.value) return;
  loadingTimeline.value = true;
  try {
    const tz = new Date().getTimezoneOffset();
    const deviceParam = selectedDevice.value === 'all' ? '' : `&device_id=${encodeURIComponent(selectedDevice.value)}`;
    timeline.value = await api(`/api/timeline?date=${selectedDate.value}&tz=${tz}${deviceParam}`);
  } catch (err) {
    console.warn('加载时间线失败', err);
  } finally {
    loadingTimeline.value = false;
  }
}

function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    await refreshCurrent();
    await refreshTimeline();
  }, 800);
}

// ── SSE 实时连接 ───────────────────────────────────────────────────────
function connectStream() {
  if (!window.EventSource) return;
  let clientId = localStorage.getItem('viewer_id');
  if (!clientId) {
    clientId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('viewer_id', clientId);
  }
  source = new EventSource(`${API_BASE}/api/stream?client_id=${encodeURIComponent(clientId)}`);
  source.addEventListener('hello', (event) => {
    try {
      viewerCount.value = JSON.parse(event.data).viewer_count;
    } catch {
      // ignore
    }
  });
  source.addEventListener('viewers', (event) => {
    try {
      viewerCount.value = JSON.parse(event.data).viewer_count;
    } catch {
      // ignore
    }
  });
  source.addEventListener('update', () => {
    scheduleRefresh();
  });
  source.addEventListener('command_update', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (myCommand.value && data.id === myCommand.value.id) myCommand.value = data;
    } catch {
      // ignore
    }
  });
  source.addEventListener('screenshot_new', (event) => {
    try {
      const shot = JSON.parse(event.data);
      screenshots.value = [shot, ...screenshots.value.filter((s) => s.id !== shot.id)].slice(0, 20);
    } catch {
      // ignore
    }
  });
  source.addEventListener('error', () => {
    // 浏览器自动重连；另有 20s 轮询保底
  });
}

function onDateChange() {
  if (!selectedDate.value) return;
  refreshTimeline();
}

// ── 日期快捷 / 导出 ─────────────────────────────────────────────────────
function setQuickDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  selectedDate.value = localDateString(d);
  refreshTimeline();
}

function shiftDate(delta) {
  const [y, m, d] = selectedDate.value.split('-').map(Number);
  const target = new Date(y, m - 1, d + delta);
  if (localDateString(target) > todayString.value) return;
  selectedDate.value = localDateString(target);
  refreshTimeline();
}

const exportUrl = computed(() => {
  const tz = new Date().getTimezoneOffset();
  const device = selectedDevice.value === 'all' ? '' : `&device_id=${encodeURIComponent(selectedDevice.value)}`;
  return `${API_BASE}/api/export?date=${selectedDate.value}&tz=${tz}${device}&format=csv`;
});

// ── 离线通知（页面打开期间生效）──────────────────────────────────────────
function setupNotifyState() {
  notifyOn.value =
    localStorage.getItem('notify_offline') === '1' &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted';
}

async function toggleNotify() {
  if (typeof Notification === 'undefined') {
    loadError.value = '当前浏览器不支持桌面通知';
    return;
  }
  if (notifyOn.value) {
    notifyOn.value = false;
    localStorage.setItem('notify_offline', '0');
    return;
  }
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
  } else if (Notification.permission !== 'granted') {
    loadError.value = '通知权限已被拒绝，请在浏览器设置里允许本站通知';
    return;
  }
  notifyOn.value = true;
  localStorage.setItem('notify_offline', '1');
}

function checkOffline(list) {
  const next = new Map(list.map((d) => [d.device_id, d.online]));
  if (prevOnline && notifyOn.value) {
    for (const [id, online] of next) {
      if (prevOnline.get(id) === true && online === false) {
        const device = list.find((d) => d.device_id === id);
        try {
          new Notification(`${device.device_name} 离线了`, {
            body: device.last_seen_at ? `最后上报：${formatRelative(device.last_seen_at)}` : '没有任何上报记录',
            icon: '/favicon.svg',
            tag: `offline-${id}`,
          });
        } catch {
          // 某些浏览器不支持 icon/tag 参数，忽略
        }
      }
    }
  }
  prevOnline = next;
}

// ── 链接深拷贝：?device=xxx&date=YYYY-MM-DD，刷新/分享保持当前视图 ──────
function readQuery() {
  const params = new URLSearchParams(window.location.search);
  const device = params.get('device');
  if (device) selectedDevice.value = device;
  const date = params.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayString.value) selectedDate.value = date;
}

function syncQuery() {
  const params = new URLSearchParams(window.location.search);
  if (selectedDevice.value === 'all') params.delete('device');
  else params.set('device', selectedDevice.value);
  if (selectedDate.value === todayString.value) params.delete('date');
  else params.set('date', selectedDate.value);
  const qs = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

onMounted(async () => {
  document.title = 'Live Dashboard';
  todayString.value = localDateString(new Date());
  setupNotifyState();
  readQuery();
  try {
    config.value = await api('/api/config');
    document.title = `${config.value.site.name} · Live Dashboard`;
    // 分享链接里的设备可能已被删除，回退到全部设备
    if (selectedDevice.value !== 'all' && !config.value.devices.some((d) => d.id === selectedDevice.value)) {
      selectedDevice.value = 'all';
    }
  } catch (err) {
    loadError.value = String(err.message || err);
  }
  await Promise.all([refreshCurrent(), refreshTimeline(), refreshScreenshots(), refreshStats()]);
  refreshAi();
  syncQuery();
  connectStream();
  pollTimer = setInterval(() => {
    refreshCurrent();
    refreshScreenshots();
    if (selectedDate.value === localDateString(new Date())) {
      refreshTimeline();
      refreshStats();
    }
  }, 20000);
});

watch([selectedDevice, selectedDate], () => {
  syncQuery();
  refreshStats();
  refreshAi();
});

watch(
  commandDevices,
  (list) => {
    if (!list.some((d) => d.device_id === commandDeviceId.value)) {
      commandDeviceId.value = list.length ? list[0].device_id : '';
    }
  },
  { immediate: true }
);

// 浏览器标签页标题跟随当前应用，切到别的标签也能看到
watch(focus, (f) => {
  const base = siteName.value || 'Live Dashboard';
  document.title = f && f.app_name ? `${f.device_name} · ${f.app_name} · ${base}` : `${base} · Live Dashboard`;
});

onBeforeUnmount(() => {
  commandPollAlive = false;
  if (refreshTimer) clearTimeout(refreshTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (commandPollTimer) clearTimeout(commandPollTimer);
  if (source) source.close();
});
</script>

<template>
  <div class="petals" aria-hidden="true">
    <span></span><span></span><span></span><span></span>
    <span></span><span></span><span></span><span></span>
  </div>

  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="13" height="10" rx="2" />
            <rect x="17" y="10" width="4" height="10" rx="1.5" />
            <path d="M3 17h13" />
          </svg>
        </div>
        <div class="brand-text">
          <h1>{{ siteName }}</h1>
          <p class="brand-sub">{{ siteDesc }}</p>
        </div>
      </div>
      <div class="header-meta">
        <span class="live-badge"><i></i>LIVE</span>
        <span class="viewer-count"><b>{{ viewerShown ?? 0 }}</b> 人围观</span>
        <button
          class="icon-btn"
          :class="{ 'is-active': notifyOn }"
          type="button"
          :aria-label="notifyOn ? '关闭离线通知' : '开启离线通知'"
          :title="notifyOn ? '离线通知已开启，点击关闭' : '设备离线时提醒我'"
          @click="toggleNotify"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </button>
        <button class="icon-btn" type="button" aria-label="切换深浅色" @click="toggleTheme">
          <span v-html="ICON_MOON"></span>
          <span v-html="ICON_SUN"></span>
        </button>
        <router-link class="ghost-btn" to="/guide">手机接入</router-link>
      </div>
    </div>
  </header>

  <main class="page">
    <section class="hero card" aria-live="polite">
      <div class="hero-main">
        <p class="hero-kicker">此刻<span class="hero-viewers"><b>{{ viewerShown ?? 0 }}</b> 人围观</span></p>
        <h2 class="hero-title" v-if="focus">
          {{ focus.device_name }}
          <span class="accent" v-if="focus.screen_on === false">息屏中</span>
          <span class="accent" v-else>正在 {{ focus.app_name || '未知应用' }}</span>
        </h2>
        <h2 class="hero-title" v-else>等待第一次上报…</h2>
        <p class="hero-status" v-if="loadError">{{ loadError }}</p>
        <p class="hero-status" v-else-if="focus">{{ focus.status_text || '' }}</p>
        <p class="hero-status" v-else>
          把电脑或手机接上，就能看到实时动态喵~
          <router-link to="/guide">看看怎么接入</router-link>
        </p>
        <p class="hero-detail" v-if="focus">
          {{ focus.display_title || (focus.secret ? '（私密应用，不公开内容）' : '') }}
        </p>
      </div>
      <div class="hero-side" v-if="focus">
        <div class="hero-device">
          <span class="platform-icon" style="width: 28px; height: 28px; border-radius: 9px" v-html="platformIcon(focus.platform)"></span>
          {{ focus.device_name }}
          <span class="online-dot" style="margin: 0"><i :style="{ background: focus.online ? 'var(--green)' : '#c4b8c6' }"></i></span>
        </div>
        <div class="hero-battery" v-if="focusBattery !== null" :class="{ charging: focusCharging }">
          {{ focusCharging ? '⚡ 充电中' : (focus.extra && focus.extra.battery_charging === false ? '🔋 未充电' : '🔋 电池') }} {{ focusBattery }}%
        </div>
        <div class="hero-updated mono">{{ focusUpdated }}</div>
      </div>
    </section>

    <section class="card shot-card" v-if="commandDevices.length || screenshots.length">
      <div class="section-head">
        <h2>远程截屏</h2>
        <span class="section-note" v-if="commandDevices.length">请求电脑截一张屏 · 电脑同意后所有围观者都能看到</span>
        <span class="section-note" v-else>所有电脑都关闭了「允许观众发指令」</span>
      </div>

      <div class="shot-bar" v-if="commandDevices.length">
        <div class="device-tabs" role="tablist">
          <button
            v-for="d in commandDevices"
            :key="d.device_id"
            class="device-tab"
            :class="{ 'is-active': commandDevice && commandDevice.device_id === d.device_id }"
            type="button"
            role="tab"
            @click="commandDeviceId = d.device_id"
          >
            {{ d.device_name }}<i class="cmd-dot" :class="{ 'is-on': d.online }"></i>
          </button>
        </div>
        <button
          class="admin-btn primary shot-btn"
          type="button"
          :disabled="commandBusy || !commandOnline"
          @click="requestScreenshot"
        >
          {{ commandBusy ? '发送中…' : commandOnline ? '请求截屏' : '电脑离线' }}
        </button>
      </div>

      <p class="shot-status" :class="shotStatusClass" v-if="shotStatus">{{ shotStatus }}</p>

      <div class="shot-feature" v-if="latestShot">
        <button class="shot-frame" type="button" @click="shotPreview = latestShot">
          <img :src="shotUrl(latestShot)" :alt="`${latestShot.device_name} 的截图`" loading="lazy" />
          <span class="shot-caption">{{ latestShot.device_name }} · {{ formatRelative(latestShot.created_at) }} · 点击放大</span>
        </button>
        <div class="shot-history" v-if="olderShots.length">
          <button
            v-for="shot in olderShots"
            :key="shot.id"
            class="shot-thumb"
            type="button"
            :title="`${shot.device_name} · ${formatShotTime(shot.created_at)}`"
            @click="shotPreview = shot"
          >
            <img :src="shotUrl(shot)" alt="" loading="lazy" />
          </button>
        </div>
      </div>
      <p class="empty" v-else>还没有截图，点上面的按钮请求一张。</p>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>设备同屏</h2>
        <span class="section-note">{{ devices.length }} 台设备 · {{ onlineCount }} 台在线</span>
      </div>
      <div class="device-grid" v-if="devices.length">
        <article
          v-for="d in devices"
          :key="d.device_id"
          class="card device-card"
          :class="d.online ? 'is-online' : 'is-offline'"
        >
          <div class="device-head">
            <div class="platform-icon" v-html="platformIcon(d.platform)"></div>
            <div style="min-width: 0">
              <div class="device-name">{{ d.device_name }}</div>
              <div class="device-platform">{{ PLATFORM_LABEL[d.platform] || d.platform }}</div>
            </div>
            <span class="online-dot"><i></i>{{ d.online ? '在线' : '离线' }}</span>
          </div>
          <div class="device-app">{{ d.app_name || '还没上报' }}</div>
          <p class="device-status">{{ d.status_text || '等待第一次上报…' }}</p>
          <div class="device-title" :title="d.display_title || ''">{{ d.display_title || '' }}</div>
          <div class="device-foot">
            <span
              v-if="Number.isFinite(Number(d.extra && d.extra.battery_percent))"
              class="battery"
              :class="{ low: Number(d.extra.battery_percent) <= 20, charging: Boolean(d.extra.battery_charging) }"
            >
              <span>{{ d.extra.battery_charging ? '⚡ 充电中' : (d.extra.battery_charging === false ? '🔋 未充电' : '🔋') }} {{ d.extra.battery_percent }}%</span>
              <span class="battery-track"><i :style="{ width: Math.min(100, Math.max(0, Number(d.extra.battery_percent))) + '%' }"></i></span>
            </span>
            <span v-else></span>
            <span>{{ lastSeenText(d) }}</span>
          </div>
          <div
            class="music"
            v-if="d.extra && d.extra.music && d.extra.music.title"
            :title="`${d.extra.music.title || ''} ${d.extra.music.artist || ''}`"
          >
            ♪ {{ d.extra.music.title }}<template v-if="d.extra.music.artist"> · {{ d.extra.music.artist }}</template><template v-if="d.extra.music.app"> · {{ d.extra.music.app }}</template>
          </div>
        </article>
      </div>
      <div class="card device-card" v-else>
        <p class="empty">还没有配置设备，请在 <router-link to="/admin" style="color: var(--accent); font-weight: 600">管理面板</router-link> 里添加。</p>
      </div>
    </section>

    <section class="card timeline-card">
      <div class="section-head">
        <h2>今日轨迹</h2>
        <div class="timeline-controls">
          <div class="device-tabs" role="tablist">
            <button
              v-for="tab in deviceTabs"
              :key="tab.id"
              class="device-tab"
              :class="{ 'is-active': selectedDevice === tab.id }"
              type="button"
              role="tab"
              @click="selectedDevice = tab.id; refreshTimeline()"
            >
              {{ tab.name }}
            </button>
          </div>
          <div class="date-quick">
            <button class="date-chip" :class="{ 'is-active': selectedDate === todayString }" type="button" @click="setQuickDate(0)">今天</button>
            <button class="date-chip" type="button" @click="setQuickDate(-1)">昨天</button>
            <button class="date-chip" type="button" title="前一天" aria-label="前一天" @click="shiftDate(-1)">‹</button>
            <input class="date-input" type="date" aria-label="选择日期" v-model="selectedDate" :max="todayString" @change="onDateChange" />
            <button class="date-chip" type="button" title="后一天" aria-label="后一天" :disabled="selectedDate >= todayString" @click="shiftDate(1)">›</button>
            <a class="date-chip export-chip" :href="exportUrl" :title="`导出 ${selectedDate} 的 CSV`">导出 CSV</a>
          </div>
        </div>
      </div>
      <div class="timeline-rows">
        <p class="empty" v-if="!timeline">加载中…</p>
        <template v-else>
          <div class="timeline-row" v-for="row in timelineRows.rows" :key="row.id">
            <div class="timeline-row-label" :title="row.name">{{ row.name }}</div>
            <div class="timeline-track-wrap">
              <div class="timeline-track">
                <span
                  v-for="(bar, idx) in row.bars"
                  :key="idx"
                  class="timeline-seg"
                  :style="{ left: bar.left + '%', width: bar.width + '%', background: bar.color }"
                  :title="bar.tip"
                ></span>
                <span v-if="row.nowPercent !== null" class="timeline-now" :style="{ left: row.nowPercent + '%' }"></span>
              </div>
              <div class="timeline-axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
              <div class="timeline-chips">
                <template v-if="row.chips.length">
                  <span v-for="chip in row.chips" :key="chip.name" class="chip">
                    <i :style="{ background: chip.color }"></i>{{ chip.name }} {{ chip.text }}
                  </span>
                </template>
                <span v-else class="chip">这一天还没有记录</span>
              </div>
            </div>
          </div>
          <p class="empty" v-if="!timelineRows.rows.length">还没有设备。</p>
        </template>
      </div>
      <div class="timeline-foot">
        <span class="timeline-hint">— 每段颜色代表一个应用，灰色是息屏（不计入时长）</span>
        <span class="timeline-total mono" v-html="timelineTotal"></span>
      </div>
    </section>

    <section class="card ai-card" v-if="aiEnabled">
      <div class="section-head">
        <h2>AI 总结</h2>
        <span class="section-note">
          {{ aiSummary.model || aiSummary.protocol || '' }}<template v-if="aiSummary.cached"> · 缓存</template>
        </span>
        <button class="admin-btn small" type="button" :disabled="aiLoading" @click="refreshAi(true)">
          {{ aiLoading ? '生成中…' : '重新生成' }}
        </button>
      </div>
      <p class="admin-muted" v-if="aiLoading">AI 正在阅读这一天的时间线…</p>
      <div class="ai-body" v-else-if="aiLines.length">
        <p v-for="(line, i) in aiLines" :key="i">{{ line }}</p>
      </div>
      <p class="empty" v-else>{{ aiError || '暂时还没有总结，点右上角重新生成。' }}</p>
    </section>

    <div class="insight-grid">
      <section class="card battery-card">
        <div class="section-head">
          <h2>电量曲线</h2>
          <span class="section-note" v-if="batteryChart">
            {{ batteryChart.deviceName }} · 最低 {{ batteryChart.min }}% · 最高 {{ batteryChart.max }}%
          </span>
        </div>
        <template v-if="batteryChart">
          <div class="battery-chart">
            <svg class="battery-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <rect
                v-for="(seg, i) in batteryChart.charging"
                :key="i"
                :x="seg.left"
                y="0"
                :width="seg.width"
                height="100"
                class="charge-band"
              ></rect>
              <polyline :points="batteryChart.points" class="battery-line" vector-effect="non-scaling-stroke"></polyline>
            </svg>
          </div>
          <div class="timeline-axis"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          <div class="chart-legend">
            <span><i class="legend-line"></i>电量</span>
            <span><i class="legend-band"></i>充电区间 {{ batteryChart.chargingMinutes ? formatMinutes(batteryChart.chargingMinutes) : '' }}</span>
            <span>开始 {{ batteryChart.start }}% → 结束 {{ batteryChart.end }}%</span>
          </div>
        </template>
        <p class="empty" v-else>还没有电量采样，等设备再上报一次电量就会出现曲线。</p>
      </section>

      <section class="card rank-card">
        <div class="section-head">
          <h2>应用时长排行</h2>
          <span class="section-note">{{ stats ? formatMinutes(stats.total_minutes) : '' }}</span>
        </div>
        <ol class="rank-list" v-if="ranking.length">
          <li class="rank-row" v-for="(item, i) in ranking" :key="item.app_name">
            <span class="rank-index">{{ i + 1 }}</span>
            <span class="rank-name" :title="item.app_name">{{ item.app_name }}</span>
            <span class="rank-bar">
              <i :style="{ width: (item.minutes / rankingMax) * 100 + '%', background: colorFor(item.app_name) }"></i>
            </span>
            <span class="rank-value">{{ formatMinutes(item.minutes) }}<em>{{ item.share }}%</em></span>
          </li>
        </ol>
        <p class="empty" v-else>这一天还没有使用记录。</p>
      </section>
    </div>

    <section class="card heatmap-card">
      <div class="section-head">
        <h2>使用热力图</h2>
        <span class="section-note">近 90 天 · 累计 {{ heatmapTotal }} · 活跃 {{ heatmap ? heatmap.active_days : 0 }} 天</span>
      </div>
      <div class="heatmap-wrap" v-if="heatmapCells.length">
        <div class="heatmap">
          <span
            v-for="cell in heatmapCells"
            :key="cell.key"
            class="heat-cell"
            :class="cell.empty ? 'is-empty' : `lvl-${cell.level}`"
            :title="cell.empty ? '' : cell.label"
          ></span>
        </div>
      </div>
      <p class="empty" v-else>暂无数据</p>
      <div class="heatmap-legend">
        <span>少</span>
        <i class="heat-cell lvl-0"></i>
        <i class="heat-cell lvl-1"></i>
        <i class="heat-cell lvl-2"></i>
        <i class="heat-cell lvl-3"></i>
        <i class="heat-cell lvl-4"></i>
        <span>多</span>
      </div>
    </section>

    <section class="card recent-card">
      <div class="section-head">
        <h2>最近动态</h2>
        <span class="section-note">跨设备汇总</span>
      </div>
      <ol class="recent-list" v-if="recent.length">
        <li class="recent-item" v-for="a in recent" :key="a.id">
          <span class="recent-time">{{ formatClock(a.started_at) }}</span>
          <div class="recent-main">
            <div class="recent-app">{{ a.app_name }}<span class="sep">·</span>{{ a.status_text || '' }}</div>
            <div class="recent-status">{{ a.display_title || '' }}</div>
          </div>
          <span class="recent-device">{{ a.device_name }}</span>
        </li>
      </ol>
      <ol class="recent-list" v-else>
        <li class="empty">还没有任何动态。<router-link to="/guide">让手机开始上报 →</router-link></li>
      </ol>
    </section>
  </main>

  <div class="shot-lightbox" v-if="shotPreview" @click="shotPreview = null">
    <button class="lightbox-close" type="button" aria-label="关闭" @click="shotPreview = null">×</button>
    <figure>
      <img :src="shotUrl(shotPreview)" :alt="`${shotPreview.device_name} 的截图`" @click.stop />
      <figcaption @click.stop>
        {{ shotPreview.device_name }} · {{ formatShotTime(shotPreview.created_at) }}
        · {{ shotPreview.width }}×{{ shotPreview.height }}
        <a :href="shotUrl(shotPreview)" :download="`screenshot-${shotPreview.id}.jpg`" target="_blank" rel="noreferrer">下载原图</a>
      </figcaption>
    </figure>
  </div>

  <footer class="site-footer">
    <span>Live Dashboard · 电脑与手机同屏围观</span>
    <span class="footer-links">
      <router-link to="/guide">接入指南</router-link>
      <router-link to="/admin">管理面板</router-link>
      <a :href="`${API_BASE}/api/current`" target="_blank" rel="noreferrer">API</a>
    </span>
  </footer>
</template>
