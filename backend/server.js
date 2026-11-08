'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { loadConfig, saveConfig, DATA_DIR, PROJECT_ROOT, PLATFORMS } = require('./lib/config');
const { hashPassword, verifyPassword } = require('./lib/password');
const { Store } = require('./lib/store');
const { CommandQueue, MAX_IMAGE_BYTES } = require('./lib/commands');
const { resolveAppMeta } = require('./lib/app-mapper');

const config = loadConfig();
const store = new Store({
  file: path.join(DATA_DIR, 'db.json'),
  retentionDays: config.retention_days,
});
const commands = new CommandQueue({
  dataDir: DATA_DIR,
  retentionDays: config.retention_days,
  onChange: (command) => broadcast('command_update', commands.publicCommand(command)),
});

// 前端构建产物：frontend/dist（前后端分目录存放）
const DIST_DIR = path.join(path.resolve(PROJECT_ROOT, '..'), 'frontend', 'dist');
let OFFLINE_MS = config.offline_after_seconds * 1000;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token',
};

// ── 实时围观人数（基于 SSE 连接的匿名客户端 id）─────────────────────────
const viewers = new Map(); // clientId -> lastSeen(ms)
const streams = new Set(); // { res, clientId }

function touchViewer(clientId) {
  viewers.set(clientId, Date.now());
}

function countViewers() {
  const cutoff = Date.now() - 90 * 1000;
  let count = 0;
  for (const [id, ts] of viewers) {
    if (ts < cutoff) {
      viewers.delete(id);
    } else {
      count += 1;
    }
  }
  return count;
}

function sendEvent(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // 连接已断开，交给 close 事件清理
  }
}

function broadcast(event, data) {
  for (const client of streams) {
    sendEvent(client, event, data);
  }
}

// ── HTTP 小工具 ─────────────────────────────────────────────────────────
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS,
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // 不是 JSON，再试表单
  }
  const obj = {};
  for (const [key, value] of new URLSearchParams(text)) {
    obj[key] = value;
  }
  return obj;
}

function str(value, max = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, max);
}

// MacroDroid 各版本魔变文本可能输出 true/false、1/0、开/关，统一解析成布尔值
function boolish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', '开', '亮', '屏幕开', '充电', '充电中', '已充电', 'ac', 'usb'].includes(v)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', '关', '灭', '屏幕关', '未充电', '放电中', 'discharging'].includes(v)) {
    return false;
  }
  return null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authenticate(req, url) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = (
    (match && match[1]) ||
    req.headers['x-device-token'] ||
    url.searchParams.get('token') ||
    ''
  ).trim();
  if (!token) return null;
  for (const device of config.devices) {
    if (safeEqual(token, device.token)) return device;
  }
  return null;
}

function deviceName(deviceId) {
  return config.devices.find((d) => d.id === deviceId)?.name || deviceId;
}

// ── 上报加密信封：AES-256-CBC + HMAC-SHA256（encrypt-then-MAC）──────────
// 密钥从设备令牌派生：base=SHA256(token)，encKey=SHA256(base||0x01)，macKey=SHA256(base||0x02)
// 明文 JSON → CBC+PKCS7 加密 → body = {enc:1, iv, data, mac}，mac 覆盖 iv||data
function deriveKeys(token) {
  const base = crypto.createHash('sha256').update(String(token), 'utf8').digest();
  return {
    encKey: crypto.createHash('sha256').update(Buffer.concat([base, Buffer.from([1])])).digest(),
    macKey: crypto.createHash('sha256').update(Buffer.concat([base, Buffer.from([2])])).digest(),
  };
}

function decryptEnvelope(device, body) {
  if (!body || body.enc !== 1) return body; // 明文上报（例如 MacroDroid 走 HTTPS）
  const { encKey, macKey } = deriveKeys(device.token);
  const iv = Buffer.from(String(body.iv || ''), 'base64');
  const data = Buffer.from(String(body.data || ''), 'base64');
  const mac = Buffer.from(String(body.mac || ''), 'base64');
  if (iv.length !== 16 || data.length === 0 || mac.length === 0) {
    throw new Error('加密信封格式不正确');
  }
  const expect = crypto.createHmac('sha256', macKey).update(Buffer.concat([iv, data])).digest();
  if (mac.length !== expect.length || !crypto.timingSafeEqual(mac, expect)) {
    throw new Error('HMAC 校验失败，密钥或数据被篡改');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(plain);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('解密后的数据不是 JSON 对象');
  }
  return parsed;
}

// ── 管理面板鉴权：密码登录 → 本进程有效的 HMAC 会话令牌 ────────────────
let bootSecret = crypto.randomBytes(32).toString('hex');
const loginAttempts = new Map(); // ip -> [timestamps]

function adminSessionToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const mac = crypto.createHmac('sha256', bootSecret).update(`admin:${exp}`).digest('hex');
  return `${exp}.${mac}`;
}

function verifyAdminToken(token) {
  const [expStr, mac] = String(token || '').split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !mac) return false;
  const expect = crypto.createHmac('sha256', bootSecret).update(`admin:${exp}`).digest('hex');
  return safeEqual(mac, expect);
}

function requireAdmin(req, url) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = (match && match[1]) || url.searchParams.get('admin_token') || '';
  return verifyAdminToken(token);
}

function clientIp(req) {
  const socket = req.socket.remoteAddress || 'unknown';
  // 只有来自本机反代（Nginx 已用 X-Real-IP 覆盖客户端传值）时才信任转发头，
  // 避免外部直接伪造 X-Forwarded-For 绕过登录限速
  if (/^(127\.|::1|::ffff:127\.)/.test(socket)) {
    const real = String(req.headers['x-real-ip'] || '').trim();
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return real || forwarded || socket;
  }
  return socket;
}

function loginTooFrequent(ip) {
  const now = Date.now();
  const list = (loginAttempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  loginAttempts.set(ip, list);
  return list.length >= 10;
}

function recordLoginAttempt(ip) {
  const list = loginAttempts.get(ip) || [];
  list.push(Date.now());
  loginAttempts.set(ip, list);
}

// ── 数据组装 ───────────────────────────────────────────────────────────
function publicDevices() {
  const now = Date.now();
  return config.devices.map((device) => {
    const state = store.getDevice(device.id);
    const meta = state && state.app_id ? resolveAppMeta(state.app_id, device.platform, state.app_name) : null;
    const lastSeen = state ? state.last_seen_at : null;
    const online = lastSeen ? now - Date.parse(lastSeen) <= OFFLINE_MS : false;
    const screenOn = state ? state.screen_on !== false : true;
    return {
      device_id: device.id,
      device_name: device.name,
      platform: device.platform,
      app_id: state ? state.app_id : '',
      app_name: meta ? meta.appName : '',
      status_text: !screenOn ? '息屏中，这段时间不计时' : (meta ? meta.statusText : '等待第一次上报…'),
      display_title: meta && !meta.secret ? (state.display_title || '') : '',
      secret: meta ? meta.secret : false,
      screen_on: screenOn,
      last_seen_at: lastSeen,
      online,
      extra: state ? state.extra : {},
    };
  });
}

function publicRecent(limit = 20) {
  // 息屏只是时间线边界，不算一条“应用动态”
  return store.recentActivities(limit)
    .filter((a) => a.screen_on !== false)
    .map((a) => {
      const meta = resolveAppMeta(a.app_id, a.platform, a.app_name);
      return {
        id: a.id,
        device_id: a.device_id,
        device_name: deviceName(a.device_id),
        platform: a.platform,
        app_id: a.app_id,
        app_name: meta.appName,
        status_text: meta.statusText,
        display_title: meta.secret ? '' : (a.display_title || ''),
        started_at: a.started_at,
      };
    });
}

function currentPayload() {
  return {
    devices: publicDevices(),
    recent_activities: publicRecent(),
    viewer_count: countViewers(),
    server_time: new Date().toISOString(),
    site: config.site,
  };
}

// ── 路由 ───────────────────────────────────────────────────────────────
async function handleReport(req, res, url) {
  const device = authenticate(req, url);
  if (!device) {
    json(res, 401, { error: 'Unauthorized：请检查 Authorization: Bearer <令牌>' });
    return;
  }

  let body;
  try {
    body = parseBody(await readBody(req));
  } catch (err) {
    if (err.statusCode === 413) {
      json(res, 413, { error: '请求体过大' });
      return;
    }
    json(res, 400, { error: '读取请求失败' });
    return;
  }

  // 支持密文信封 {enc:1,iv,data,mac}，也兼容明文 JSON / 表单
  let payload;
  try {
    payload = decryptEnvelope(device, body);
  } catch (err) {
    json(res, 400, { error: `解密失败：${err.message}` });
    return;
  }

  const previous = store.state.devices[device.id] || null;
  let appId = str(
    payload.app_id ?? payload.appId ?? payload.package ?? payload.app_package ?? payload.pkg,
    128
  );
  const explicitApp = Boolean(appId);
  const appLabel = str(payload.app_label ?? payload.appLabel ?? payload.label ?? payload.app_name, 64);
  if (!appId) {
    // 只上报屏幕/充电状态时沿用上一次的应用，手机端不用再读前台应用
    appId = previous ? previous.app_id : '';
    if (!appId) {
      json(res, 400, { error: 'app_id 不能为空' });
      return;
    }
  }
  const windowTitle = str(payload.window_title ?? payload.title, 256);

  // 时间戳仅用于展示，偏差超过 5 分钟就改用服务器时间
  let startedAt = new Date().toISOString();
  const rawTimestamp = str(payload.timestamp ?? payload.time, 64);
  if (rawTimestamp) {
    const parsed = Date.parse(rawTimestamp);
    if (Number.isFinite(parsed) && Math.abs(parsed - Date.now()) < 5 * 60 * 1000) {
      startedAt = new Date(parsed).toISOString();
    }
  }

  // extra：支持嵌套对象，也支持 MacroDroid 常用的扁平字段
  let extraSrc = payload.extra;
  if (typeof extraSrc === 'string') {
    try {
      extraSrc = JSON.parse(extraSrc);
    } catch {
      extraSrc = {};
    }
  }
  if (!extraSrc || typeof extraSrc !== 'object' || Array.isArray(extraSrc)) extraSrc = {};

  const extra = {};
  const prevExtra = (previous && previous.extra) || {};
  const batteryRaw = Number(payload.battery_percent ?? payload.battery_level ?? payload.battery ?? extraSrc.battery_percent);
  if (Number.isFinite(batteryRaw)) {
    extra.battery_percent = Math.max(0, Math.min(100, Math.round(batteryRaw)));
  } else if (prevExtra.battery_percent !== undefined) {
    // 息屏/亮屏这类只带 screen_on 的上报，沿用上一次的电量
    extra.battery_percent = prevExtra.battery_percent;
  }
  const charging = boolish(payload.battery_charging ?? payload.charging ?? extraSrc.battery_charging);
  if (charging !== null) {
    extra.battery_charging = charging;
  } else if (prevExtra.battery_charging !== undefined) {
    extra.battery_charging = prevExtra.battery_charging;
  }

  // 息屏上报：结束后台当前应用段，之后的时间不计入使用时长
  const prevScreenOn = previous ? previous.screen_on !== false : true;
  let screenOn = boolish(
    payload.screen_on ?? payload.screen ?? payload.screen_state ?? payload.screen_status ?? extraSrc.screen_on
  );
  if (screenOn === null && boolish(payload.screen_off) === true) screenOn = false;
  // 没带屏幕状态时沿用上一次：桌面 agent 默认亮屏，手机定时上报也不会把息屏改回亮屏
  if (screenOn === null) screenOn = prevScreenOn;
  extra.screen_on = screenOn;
  const music = extraSrc.music;
  if (music && typeof music === 'object' && !Array.isArray(music)) {
    const clean = {};
    for (const key of ['title', 'artist', 'app']) {
      const v = str(music[key], 256);
      if (v) clean[key] = v;
    }
    if (Object.keys(clean).length > 0) extra.music = clean;
  }

  const meta = resolveAppMeta(
    appId,
    device.platform,
    appLabel || (previous && previous.app_id === appId ? previous.app_name : ''),
    windowTitle
  );
  store.report({
    device,
    appId: meta.effectiveAppId,
    appName: meta.appName,
    displayTitle: meta.displayTitle,
    startedAt,
    extra,
    screenOn,
    // 只上报充电/息屏状态时只更新设备状态，不在时间线里重复记一条同一个应用
    recordActivity: explicitApp || screenOn !== prevScreenOn,
  });

  broadcast('update', {
    viewer_count: countViewers(),
    server_time: new Date().toISOString(),
  });

  json(res, 200, {
    ok: true,
    device_id: device.id,
    app_name: meta.appName,
    status_text: meta.statusText,
  });
}

// 按日期 / 时区 / 设备计算时间线，供 /api/timeline 与 /api/export 复用
function computeTimeline(url) {
  const date = url.searchParams.get('date') || '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return { error: 'date 参数格式应为 YYYY-MM-DD' };

  const tzRaw = url.searchParams.get('tz');
  const tz = tzRaw === null ? new Date().getTimezoneOffset() : Number(tzRaw);
  if (!Number.isFinite(tz) || tz < -840 || tz > 840) return { error: 'tz 参数无效' };

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const startMs = Date.UTC(year, month - 1, day) + tz * 60000;
  const probe = new Date(startMs - tz * 60000);
  if (
    Number.isNaN(startMs) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { error: '日期不存在' };
  }

  const deviceId = url.searchParams.get('device_id');
  if (deviceId && !config.devices.some((d) => d.id === deviceId)) {
    return { payload: { date, timezone_offset: tz, segments: [], summary: {} } };
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
  const result = store.timeline(startIso, endIso, deviceId || null);

  const segments = result.segments.map((s) => {
    const screenOn = s.screen_on !== false;
    const meta = resolveAppMeta(s.app_id, s.platform, s.app_name);
    return {
      ...s,
      app_name: screenOn ? meta.appName : '息屏',
      status_text: screenOn ? meta.statusText : '息屏中，不计时',
      display_title: screenOn && !meta.secret ? (s.display_title || '') : '',
      screen_on: screenOn,
      device_name: deviceName(s.device_id),
    };
  });

  // 用映射后的名字重新汇总，私密应用等改名才能反映到统计里；息屏时段不计时长
  const summary = {};
  for (const s of segments) {
    if (!s.screen_on) continue;
    if (!summary[s.device_id]) summary[s.device_id] = {};
    summary[s.device_id][s.app_name] = (summary[s.device_id][s.app_name] || 0) + s.duration_minutes;
  }

  return { payload: { date, timezone_offset: tz, segments, summary } };
}

function handleTimeline(res, url) {
  const result = computeTimeline(url);
  if (result.error) {
    json(res, 400, { error: result.error });
    return;
  }
  json(res, 200, result.payload);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// tz 为 getTimezoneOffset 的分钟数（东八区 = -480），换算成设备所在本地时间
function localClock(iso, tz) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms - tz * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function handleExport(res, url) {
  const result = computeTimeline(url);
  if (result.error) {
    json(res, 400, { error: result.error });
    return;
  }
  const payload = result.payload;
  const tz = payload.timezone_offset;
  const deviceId = url.searchParams.get('device_id') || '';
  const format = (url.searchParams.get('format') || 'csv').toLowerCase();
  const suffix = deviceId ? `-${deviceId.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const filename = `timeline-${payload.date}${suffix}`;

  if (format === 'json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.json"`,
      'Cache-Control': 'no-store',
      ...CORS,
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  const rows = [['设备', '平台', '应用', '开始', '结束', '时长(分钟)', '窗口标题']];
  for (const s of payload.segments) {
    rows.push([
      s.device_name,
      s.platform,
      s.app_name,
      localClock(s.started_at, tz),
      s.ended_at ? localClock(s.ended_at, tz) : '',
      s.duration_minutes,
      s.display_title || '',
    ]);
  }
  // 加 BOM，Excel 打开中文才不会乱码
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}.csv"`,
    'Cache-Control': 'no-store',
    ...CORS,
  });
  res.end(csv);
}

function handleStream(req, res, url) {
  const clientId = str(url.searchParams.get('client_id'), 64) || crypto.randomUUID();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS,
  });
  res.write(': connected\n\n');

  const client = { res, clientId };
  streams.add(client);
  touchViewer(clientId);
  sendEvent(client, 'hello', {
    viewer_count: countViewers(),
    server_time: new Date().toISOString(),
  });
  broadcast('viewers', { viewer_count: countViewers() });

  req.on('close', () => {
    streams.delete(client);
    broadcast('viewers', { viewer_count: countViewers() });
  });
}

function configPayload(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return {
    site: config.site,
    devices: config.devices.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      allow_commands: d.allow_commands,
    })),
    viewer_count: countViewers(),
    server_time: new Date().toISOString(),
    report_url: `${proto}://${host}/api/report`,
    offline_after_seconds: config.offline_after_seconds,
    command_timeout_seconds: 20,
    command_limit_seconds: 30,
  };
}

// ── 观众指令（目前只有截屏） ───────────────────────────────────────────
function deviceOnline(deviceId) {
  const state = store.getDevice(deviceId);
  if (!state || !state.last_seen_at) return false;
  const ts = Date.parse(state.last_seen_at);
  return Number.isFinite(ts) && Date.now() - ts <= OFFLINE_MS;
}

// 观众发起指令：任何人可发，但同一 IP 30 秒只能发 1 次
async function handleCreateCommand(req, res) {
  let body;
  try {
    body = parseBody(await readBody(req));
  } catch (err) {
    json(res, err.statusCode === 413 ? 413 : 400, {
      error: err.statusCode === 413 ? '请求体过大' : '读取请求失败',
    });
    return;
  }

  const device = config.devices.find((d) => d.id === str(body.device_id, 64));
  if (!device) {
    json(res, 404, { error: '设备不存在' });
    return;
  }
  const kind = (str(body.kind, 16) || 'screenshot').toLowerCase();
  if (kind !== 'screenshot') {
    json(res, 400, { error: '暂不支持这种指令' });
    return;
  }
  if (device.platform !== 'windows') {
    json(res, 400, { error: '只有电脑设备支持截屏' });
    return;
  }
  if (!device.allow_commands) {
    json(res, 403, { error: '这台电脑没有开启观众指令' });
    return;
  }
  if (!deviceOnline(device.id)) {
    json(res, 409, { error: '电脑离线，稍后再试' });
    return;
  }

  const ip = clientIp(req);
  const rate = commands.checkRate(ip);
  if (!rate.ok) {
    json(res, 429, { error: `发得太快了，${rate.retryAfter} 秒后再试`, retry_after: rate.retryAfter });
    return;
  }

  const result = commands.create({ device, ip });
  if (result.error) {
    json(res, result.status, { error: result.error });
    return;
  }
  json(res, 200, { ok: true, command: commands.publicCommand(result.command) });
}

function handleCommandStatus(res, url) {
  const id = url.pathname.slice('/api/command/'.length);
  const command = commands.get(id);
  if (!command) {
    json(res, 404, { error: '指令不存在' });
    return;
  }
  json(res, 200, { ok: true, command: commands.publicCommand(command) });
}

// 电脑侧长轮询：有指令立刻返回，没有就挂起 ~25 秒
async function handleAgentCommands(req, res, url) {
  const device = authenticate(req, url);
  if (!device) {
    json(res, 401, { error: 'Unauthorized：请检查设备令牌' });
    return;
  }
  if (!device.allow_commands) {
    json(res, 200, { ok: true, allowed: false, command: null, server_time: new Date().toISOString() });
    return;
  }
  const rawTimeout = Number(url.searchParams.get('timeout'));
  const seconds = Number.isFinite(rawTimeout) ? Math.min(30, Math.max(5, rawTimeout)) : 25;
  const command = await commands.waitFor(device.id, seconds * 1000);
  json(res, 200, {
    ok: true,
    allowed: true,
    command: commands.publicCommand(command),
    server_time: new Date().toISOString(),
  });
}

// 电脑已收到指令（弹窗之前先回执），把 20 秒审批计时换成截屏上传宽限
async function handleCommandAck(req, res, url) {
  const device = authenticate(req, url);
  if (!device) {
    json(res, 401, { error: 'Unauthorized：请检查设备令牌' });
    return;
  }
  let body;
  try {
    body = parseBody(await readBody(req));
  } catch {
    json(res, 400, { error: '读取请求失败' });
    return;
  }
  const command = commands.ack(str(body.id, 64), device.id);
  if (!command) {
    json(res, 404, { error: '指令不存在' });
    return;
  }
  json(res, 200, { ok: command.status === 'pending', command: commands.publicCommand(command) });
}

// 电脑回执：同意（带 JPEG base64）或拒绝
async function handleCommandResult(req, res, url) {
  const device = authenticate(req, url);
  if (!device) {
    json(res, 401, { error: 'Unauthorized：请检查设备令牌' });
    return;
  }
  let body;
  try {
    body = parseBody(await readBody(req, MAX_IMAGE_BYTES + 4 * 1024 * 1024));
  } catch (err) {
    json(res, err.statusCode === 413 ? 413 : 400, {
      error: err.statusCode === 413 ? '截图太大' : '读取请求失败',
    });
    return;
  }

  const command = commands.get(str(body.id, 64));
  if (!command || command.device_id !== device.id) {
    json(res, 404, { error: '指令不存在' });
    return;
  }
  if (command.status !== 'pending') {
    json(res, 409, { error: '指令已超时或已处理', command: commands.publicCommand(command) });
    return;
  }

  const decision = (str(body.decision, 16) || '').toLowerCase();

  if (decision === 'reject') {
    const updated = commands.finish(command, 'rejected', { error: str(body.error, 128) || '电脑拒绝了请求' });
    json(res, 200, { ok: true, command: commands.publicCommand(updated) });
    return;
  }
  if (decision !== 'approve') {
    json(res, 400, { error: 'decision 必须是 approve 或 reject' });
    return;
  }

  // 私密应用不上屏：当前前台应用命中私密名单就放弃这次截图
  const state = store.getDevice(device.id);
  const meta = state && state.app_id ? resolveAppMeta(state.app_id, device.platform, state.app_name) : null;
  if (meta && meta.secret) {
    const updated = commands.finish(command, 'rejected', { error: '当前是私密应用，已跳过截屏' });
    json(res, 200, { ok: false, command: commands.publicCommand(updated) });
    return;
  }

  const rawImage = String(body.image || '').replace(/^data:image\/[a-z0-9+]+;base64,/i, '');
  const buffer = Buffer.from(rawImage, 'base64');
  if (!buffer.length) {
    json(res, 400, { error: '截图数据为空' });
    return;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    json(res, 413, { error: '截图太大' });
    return;
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    json(res, 400, { error: '截图不是有效的 JPEG' });
    return;
  }

  let shot;
  try {
    shot = commands.addScreenshot({
      device,
      commandId: command.id,
      buffer,
      width: Number(body.width),
      height: Number(body.height),
    });
  } catch (err) {
    json(res, 500, { error: `保存截图失败：${err.message}` });
    return;
  }

  const updated = commands.finish(command, 'approved', { screenshot_id: shot.id });
  broadcast('screenshot_new', shot);
  json(res, 200, { ok: true, screenshot: shot, command: commands.publicCommand(updated) });
}

// ── 管理 API ───────────────────────────────────────────────────────────
function uniqueDeviceId(desired) {
  let base = String(desired || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = 'device';
  let id = base;
  let n = 2;
  while (config.devices.some((d) => d.id === id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

async function handleAdminApi(req, res, url) {
  const { pathname } = url;
  const ip = clientIp(req);

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    if (loginTooFrequent(ip)) {
      json(res, 429, { error: '尝试次数过多，请 10 分钟后再试' });
      return;
    }
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const password = str(body.password, 128);
    if (!password || !verifyPassword(password, config.admin_password)) {
      recordLoginAttempt(ip);
      json(res, 401, { error: '密码错误' });
      return;
    }
    loginAttempts.delete(ip);
    json(res, 200, { ok: true, token: adminSessionToken() });
    return;
  }

  // 以下接口全部需要有效的管理会话
  if (!requireAdmin(req, url)) {
    json(res, 401, { error: '请先登录管理面板' });
    return;
  }

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    json(res, 200, {
      site: config.site,
      port: config.port,
      offline_after_seconds: config.offline_after_seconds,
      retention_days: config.retention_days,
      https: config.https,
      devices: config.devices.map((d) => ({ ...d })),
      stats: store.stats(),
      uptime_seconds: Math.round(process.uptime()),
      viewer_count: countViewers(),
    });
    return;
  }

  if (pathname === '/api/admin/settings' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const name = str(body.name, 64);
    const description = str(body.description, 128);
    if (name) config.site.name = name;
    if (body.description !== undefined) config.site.description = description;
    if (Number.isFinite(Number(body.offline_after_seconds))) {
      config.offline_after_seconds = Math.max(10, Math.round(Number(body.offline_after_seconds)));
      OFFLINE_MS = config.offline_after_seconds * 1000;
    }
    if (Number.isFinite(Number(body.retention_days))) {
      config.retention_days = Math.max(1, Math.round(Number(body.retention_days)));
      store.setRetentionDays(config.retention_days);
      commands.setRetentionDays(config.retention_days);
    }
    saveConfig(config);
    json(res, 200, {
      ok: true,
      site: config.site,
      offline_after_seconds: config.offline_after_seconds,
      retention_days: config.retention_days,
    });
    return;
  }

  if (pathname === '/api/admin/devices' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const name = str(body.name, 32);
    const platform = str(body.platform, 16).toLowerCase();
    if (!name) {
      json(res, 400, { error: '设备名称不能为空' });
      return;
    }
    if (!PLATFORMS.includes(platform)) {
      json(res, 400, { error: `platform 必须是：${PLATFORMS.join(', ')}` });
      return;
    }
    const device = {
      id: uniqueDeviceId(body.id),
      name,
      platform,
      token: crypto.randomBytes(16).toString('hex'),
      allow_commands: false,
    };
    config.devices.push(device);
    saveConfig(config);
    json(res, 200, { ok: true, device });
    return;
  }

  if (pathname === '/api/admin/devices/update' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const device = config.devices.find((d) => d.id === str(body.id, 64));
    if (!device) {
      json(res, 404, { error: '设备不存在' });
      return;
    }
    const name = str(body.name, 32);
    const platform = str(body.platform, 16).toLowerCase();
    if (name) device.name = name;
    if (platform) {
      if (!PLATFORMS.includes(platform)) {
        json(res, 400, { error: `platform 必须是：${PLATFORMS.join(', ')}` });
        return;
      }
      device.platform = platform;
    }
    if (body.allow_commands !== undefined) {
      device.allow_commands = Boolean(body.allow_commands);
    }
    saveConfig(config);
    json(res, 200, { ok: true, device });
    return;
  }

  if (pathname === '/api/admin/devices/delete' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const id = str(body.id, 64);
    const before = config.devices.length;
    config.devices = config.devices.filter((d) => d.id !== id);
    if (config.devices.length === before) {
      json(res, 404, { error: '设备不存在' });
      return;
    }
    store.clearDevice(id);
    commands.clearDevice(id);
    saveConfig(config);
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/admin/devices/token' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const device = config.devices.find((d) => d.id === str(body.id, 64));
    if (!device) {
      json(res, 404, { error: '设备不存在' });
      return;
    }
    device.token = crypto.randomBytes(16).toString('hex');
    saveConfig(config);
    json(res, 200, { ok: true, token: device.token });
    return;
  }

  if (pathname === '/api/admin/data/clear' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const deviceId = str(body.device_id, 64);
    if (deviceId) {
      if (!config.devices.some((d) => d.id === deviceId)) {
        json(res, 404, { error: '设备不存在' });
        return;
      }
      store.clearDevice(deviceId);
      commands.clearDevice(deviceId);
    } else {
      store.clearAll();
      commands.clearAll();
    }
    store.flush();
    json(res, 200, { ok: true, stats: store.stats() });
    return;
  }

  if (pathname === '/api/admin/password' && req.method === 'POST') {
    let body;
    try {
      body = parseBody(await readBody(req));
    } catch {
      json(res, 400, { error: '读取请求失败' });
      return;
    }
    const password = str(body.password, 128);
    if (password.length < 6) {
      json(res, 400, { error: '密码至少 6 位' });
      return;
    }
    config.admin_password = hashPassword(password);
    saveConfig(config);
    // 轮换会话密钥：其他已登录的会话全部失效
    bootSecret = crypto.randomBytes(32).toString('hex');
    loginAttempts.clear();
    json(res, 200, { ok: true, token: adminSessionToken() });
    return;
  }

  json(res, 404, { error: 'Not found' });
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    await handleAdminApi(req, res, url);
    return;
  }

  if (pathname === '/api/report' && req.method === 'POST') {
    await handleReport(req, res, url);
    return;
  }
  if (pathname === '/api/current' && req.method === 'GET') {
    json(res, 200, currentPayload());
    return;
  }
  if (pathname === '/api/timeline' && req.method === 'GET') {
    handleTimeline(res, url);
    return;
  }

  if (pathname === '/api/export' && req.method === 'GET') {
    handleExport(res, url);
    return;
  }
  if (pathname === '/api/config' && req.method === 'GET') {
    json(res, 200, configPayload(req));
    return;
  }
  if (pathname === '/api/stream' && req.method === 'GET') {
    handleStream(req, res, url);
    return;
  }
  if (pathname === '/api/command' && req.method === 'POST') {
    await handleCreateCommand(req, res);
    return;
  }
  if (pathname.startsWith('/api/command/') && req.method === 'GET') {
    handleCommandStatus(res, url);
    return;
  }
  if (pathname === '/api/agent/commands' && req.method === 'GET') {
    await handleAgentCommands(req, res, url);
    return;
  }
  if (pathname === '/api/agent/command-ack' && req.method === 'POST') {
    await handleCommandAck(req, res, url);
    return;
  }
  if (pathname === '/api/agent/command-result' && req.method === 'POST') {
    await handleCommandResult(req, res, url);
    return;
  }
  if (pathname === '/api/screenshots' && req.method === 'GET') {
    json(res, 200, {
      screenshots: commands.listScreenshots(Number(url.searchParams.get('limit')) || 20),
      server_time: new Date().toISOString(),
    });
    return;
  }
  if (pathname.startsWith('/api/screenshot/') && req.method === 'GET') {
    const id = pathname.slice('/api/screenshot/'.length);
    const buffer = commands.readScreenshot(id);
    if (!buffer) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
      ...CORS,
    });
    res.end(buffer);
    return;
  }
  if (pathname === '/api/health' && req.method === 'GET') {
    json(res, 200, { ok: true, uptime: process.uptime() });
    return;
  }

  json(res, 404, { error: 'Not found' });
}

// ── 静态文件 ───────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  let relative = pathname === '/' ? '/index.html' : pathname;

  const distIndex = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(distIndex)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建：请在 frontend 目录执行 npm install && npm run build\n');
    return;
  }

  // SPA history 路由：没有扩展名的路径一律回退到 index.html，由前端路由接管
  if (relative === '/' || relative === '/index.html' || !path.extname(relative)) {
    res.writeHead(200, {
      'Content-Type': MIME['.html'],
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(distIndex).pipe(res);
    return;
  }
  serveFrom(res, DIST_DIR, relative);
}

function serveFrom(res, rootDir, relative) {
  const resolved = path.resolve(rootDir, `.${relative}`);
  const rel = path.relative(rootDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

// ── 启动 ───────────────────────────────────────────────────────────────
function buildRequestHandler() {
  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const run = async () => {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else {
        serveStatic(req, res, url);
      }
    };
    run().catch((err) => {
      console.error('[server] 未处理的错误：', err);
      if (!res.headersSent) {
        json(res, 500, { error: '服务器内部错误' });
      } else {
        res.end();
      }
    });
  };
}

const port = Number.isFinite(config.port) ? config.port : 3000;
let server;
let serverProto = 'http';

if (config.https.enabled) {
  try {
    const tls = {
      cert: fs.readFileSync(path.resolve(PROJECT_ROOT, config.https.cert)),
      key: fs.readFileSync(path.resolve(PROJECT_ROOT, config.https.key)),
    };
    server = https.createServer(tls, buildRequestHandler());
    serverProto = 'https';
  } catch (err) {
    console.error(`[server] 读取 HTTPS 证书失败：${err.message}`);
    console.error('[server] 已回退为 HTTP，请检查 config.json 的 https.cert / https.key');
    server = http.createServer(buildRequestHandler());
  }
} else {
  server = http.createServer(buildRequestHandler());
}

server.listen(port, () => {
  const scheme = `${serverProto}://`;
  const candidates = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const virtual = /vEthernet|virtual|vmware|vbox|hyper-v|wsl|tun|tap|tailscale|zerotier|radmin|hamachi/i.test(name);
      candidates.push({ ip: info.address, name, virtual });
    }
  }

  const lanIps = candidates.filter((c) => !c.virtual);
  const preferred =
    lanIps.find((c) => /^192\.168\./.test(c.ip)) ||
    lanIps.find((c) => /^10\./.test(c.ip)) ||
    lanIps[0] ||
    candidates[0];

  console.log(`[server] Live Dashboard 已启动：${scheme}localhost:${port}`);
  for (const c of candidates) {
    console.log(`[server] 局域网访问（${c.name}）：${scheme}${c.ip}:${port}`);
  }
  console.log(`[server] 设备上报地址：${scheme}${preferred ? preferred.ip : 'localhost'}:${port}/api/report`);
  console.log(`[server] 手机接入指南：${scheme}localhost:${port}/guide`);
  console.log(`[server] 管理面板：${scheme}localhost:${port}/admin`);
  if (serverProto === 'http') {
    console.log('[server] 提示：当前是 HTTP 明文传输，部署到公网服务器建议开启 HTTPS（见 /guide 部署章节）');
  }
});

const heartbeat = setInterval(() => {
  for (const client of streams) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      // 忽略，close 事件会清理
    }
  }
}, 25 * 1000);
heartbeat.unref();

const cleanup = setInterval(() => {
  store.prune();
  store.scheduleSave();
  commands.prune();
}, 60 * 60 * 1000);
cleanup.unref();

function shutdown() {
  console.log('\n[server] 正在退出，保存数据…');
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
