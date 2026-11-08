'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { hashPassword, isPasswordHash } = require('./password');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.resolve(PROJECT_ROOT, process.env.CONFIG_FILE || 'config.json');
const DATA_DIR = path.resolve(PROJECT_ROOT, process.env.DATA_DIR || 'data');

const PLATFORMS = ['windows', 'android', 'macos', 'linux', 'ios'];
const DEFAULT_SITE = { name: '我的视监面板', description: '此刻我正在做什么' };

// AI 总结默认配置：接口协议 + 自填 API 地址/模型/Key，全部在管理面板里配置
const DEFAULT_AI = {
  enabled: false,
  protocol: 'openai',
  api_key: '',
  base_url: '',
  model: '',
  temperature: 0.4,
  max_tokens: 600,
  cache_minutes: 30,
};
const AI_PROTOCOLS = ['openai', 'ollama', 'anthropic', 'gemini'];

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function defaultConfig() {
  return {
    site: { ...DEFAULT_SITE },
    port: 3000,
    offline_after_seconds: 120,
    retention_days: 7,
    admin_password: '', // 启动时生成 scrypt 哈希，明文只在日志里打印一次
    https: { enabled: false, cert: '', key: '' },
    ai: { ...DEFAULT_AI },
    devices: [
      { id: 'my-pc', name: '我的电脑', platform: 'windows', token: randomToken(), allow_commands: false },
      { id: 'my-phone', name: '我的手机', platform: 'android', token: randomToken(), allow_commands: false },
    ],
  };
}

function normalizeDevice(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  const platform = String(raw.platform || '').trim().toLowerCase();
  const token = String(raw.token || '').trim();
  if (!id || !name || !PLATFORMS.includes(platform) || !token) {
    console.warn(`[config] 跳过第 ${index + 1} 个设备：id/name/platform/token 不完整`);
    return null;
  }
  // allow_commands：是否允许观众向这台电脑下发指令（截屏），默认关闭
  return { id, name, platform, token, allow_commands: Boolean(raw.allow_commands) };
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalize(raw) {
  const cfg = { ...defaultConfig(), ...raw };
  cfg.site = { ...DEFAULT_SITE, ...(raw && raw.site) };
  cfg.port = Number.isFinite(Number(cfg.port)) ? Number(cfg.port) : 3000;
  cfg.offline_after_seconds = Math.max(10, Number(cfg.offline_after_seconds) || 120);
  cfg.retention_days = Math.max(1, Number(cfg.retention_days) || 7);
  cfg.admin_password = String((raw && raw.admin_password) || '').trim();
  const httpsRaw = (raw && raw.https) || {};
  cfg.https = {
    enabled: Boolean(httpsRaw.enabled),
    cert: String(httpsRaw.cert || '').trim(),
    key: String(httpsRaw.key || '').trim(),
  };

  const aiRaw = (raw && raw.ai) || {};
  const protocol = String(aiRaw.protocol || DEFAULT_AI.protocol).trim();
  cfg.ai = {
    enabled: Boolean(aiRaw.enabled),
    protocol: AI_PROTOCOLS.includes(protocol) ? protocol : DEFAULT_AI.protocol,
    api_key: String(aiRaw.api_key || '').trim(),
    base_url: String(aiRaw.base_url || '').trim(),
    model: String(aiRaw.model || '').trim(),
    temperature: clamp(Number(aiRaw.temperature), 0, 2, DEFAULT_AI.temperature),
    max_tokens: Math.round(clamp(Number(aiRaw.max_tokens), 50, 4000, DEFAULT_AI.max_tokens)),
    cache_minutes: Math.round(clamp(Number(aiRaw.cache_minutes), 0, 1440, DEFAULT_AI.cache_minutes)),
  };

  const devices = (Array.isArray(raw && raw.devices) ? raw.devices : [])
    .map(normalizeDevice)
    .filter(Boolean);

  const ids = new Set();
  const tokens = new Set();
  const unique = [];
  for (const d of devices) {
    if (ids.has(d.id)) {
      console.warn(`[config] 设备 id 重复，已跳过：${d.id}`);
      continue;
    }
    if (tokens.has(d.token)) {
      console.warn(`[config] 设备令牌重复，已跳过：${d.name}`);
      continue;
    }
    ids.add(d.id);
    tokens.add(d.token);
    unique.push(d);
  }
  cfg.devices = unique;
  return cfg;
}

function createConfigFile() {
  const cfg = defaultConfig();
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');

  console.log('[config] 第一次运行，已自动生成 config.json');
  for (const d of cfg.devices) {
    console.log(`[config]   ${d.name} (${d.platform})  id=${d.id}  令牌=${d.token}`);
  }
  console.log('[config] 上面的令牌就是手机 MacroDroid 上报时要带的 Authorization');
  return cfg;
}

function loadConfig() {
  let raw;
  if (!fs.existsSync(CONFIG_PATH)) {
    raw = createConfigFile();
  } else {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      console.error(`[config] config.json 解析失败：${err.message}`);
      process.exit(1);
    }
  }

  const cfg = normalize(raw);
  const storedPassword = String((raw && raw.admin_password) || '').trim();
  if (!storedPassword) {
    // 首次生成管理密码：明文只打印这一次，config.json 里存哈希
    const plain = randomToken();
    cfg.admin_password = hashPassword(plain);
    persist(cfg);
    console.log(`[config] 已生成管理面板密码：${plain}`);
    console.log('[config] 仅显示这一次，config.json 中只保存加密哈希');
    console.log('[config] 忘记密码可在服务器执行：node reset-password.js');
  } else if (!isPasswordHash(storedPassword)) {
    // 旧版本存的是明文，自动迁移为哈希，原密码继续可用
    cfg.admin_password = hashPassword(storedPassword);
    persist(cfg);
    console.log('[config] 管理密码已从明文迁移为 scrypt 哈希（原密码继续可用）');
  }
  if (cfg.devices.length === 0) {
    console.warn('[config] 当前没有配置任何设备，可在管理面板 /admin 中添加。');
  }
  return cfg;
}

/** 原子写回 config.json（管理面板保存配置时使用）。 */
function persist(cfg) {
  try {
    const tmp = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (err) {
    console.error(`[config] 保存 config.json 失败：${err.message}`);
  }
}

module.exports = {
  loadConfig,
  saveConfig: persist,
  PROJECT_ROOT,
  CONFIG_PATH,
  DATA_DIR,
  PLATFORMS,
};
