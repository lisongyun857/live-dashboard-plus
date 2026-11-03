'use strict';

// ── 观众指令队列 + 截屏存储 ─────────────────────────────────────────────
// 目前只实现「截屏」一种指令，但结构按通用指令设计（kind 字段 + 结果回执）。
// 指令本身只在内存里（20 秒内就要出结果），截图文件与索引落盘，
// 按 retention_days 与活动记录一起过期清理。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APPROVAL_TIMEOUT_MS = 20 * 1000; // 电脑 20 秒不处理 → 自动拒绝
const ACK_GRACE_MS = 45 * 1000; // 电脑点了「同意」后留给截屏+上传的时间
const RATE_LIMIT_MS = 30 * 1000; // 同一 IP 30 秒只能发 1 次
const MAX_PENDING_PER_DEVICE = 5; // 每台电脑最多 5 条排队
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 单张截图上限（base64 解码后）
const INDEX_LIMIT = 200; // 索引最多保留多少条
const SCREENSHOT_RETENTION_DAYS = 1; // 截图最多保留 1 天，到期自动删除

class CommandQueue {
  constructor({ dataDir, retentionDays, onChange }) {
    this.dir = path.join(dataDir, 'screenshots');
    this.indexFile = path.join(this.dir, 'index.json');
    this.retentionDays = Math.max(1, Number(retentionDays) || 7);
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.commands = new Map(); // id -> command
    this.timers = new Map(); // id -> timeout
    this.waiters = new Map(); // deviceId -> [resolve]
    this.ipStamps = new Map(); // ip -> last command ts
    this.screenshots = [];
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      // 目录创建失败时后续写入会报错，日志里能看到
    }
    this.loadIndex();
  }

  // ── 截图索引 ─────────────────────────────────────────────────────────
  loadIndex() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      this.screenshots = Array.isArray(raw.screenshots) ? raw.screenshots : [];
    } catch {
      this.screenshots = [];
    }
    this.prune();
  }

  saveIndex() {
    try {
      const tmp = `${this.indexFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ screenshots: this.screenshots }, null, 2), 'utf8');
      fs.renameSync(tmp, this.indexFile);
    } catch (err) {
      console.error(`[commands] 保存截图索引失败：${err.message}`);
    }
  }

  prune() {
    // 截图固定最多留 1 天（retentionDays 控制的是活动记录，不放大截图寿命）
    const days = Math.min(this.retentionDays, SCREENSHOT_RETENTION_DAYS);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const keep = [];
    let changed = false;
    for (const shot of this.screenshots) {
      const ts = Date.parse(shot.created_at);
      if (Number.isFinite(ts) && ts >= cutoff && keep.length < INDEX_LIMIT) {
        keep.push(shot);
        continue;
      }
      this.removeFile(shot.id);
      changed = true;
    }
    if (changed || keep.length !== this.screenshots.length) {
      this.screenshots = keep;
      this.saveIndex();
    }
  }

  setRetentionDays(days) {
    const n = Math.max(1, Number(days) || 7);
    if (n === this.retentionDays) return;
    this.retentionDays = n;
    this.prune();
  }

  pathFor(id) {
    return path.join(this.dir, `${id}.jpg`);
  }

  removeFile(id) {
    if (!/^[a-z0-9-]+$/i.test(String(id || ''))) return;
    try {
      fs.unlinkSync(this.pathFor(id));
    } catch {
      // 文件已经不在了
    }
  }

  // ── 限流 / 指令创建 ──────────────────────────────────────────────────
  checkRate(ip) {
    const key = String(ip || 'unknown');
    const now = Date.now();
    const last = this.ipStamps.get(key) || 0;
    if (now - last < RATE_LIMIT_MS) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000)) };
    }
    this.ipStamps.set(key, now);
    // 顺手清掉过期的 IP 记录，避免 Map 无限增长
    for (const [k, ts] of this.ipStamps) {
      if (now - ts > RATE_LIMIT_MS * 4) this.ipStamps.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }

  pendingFor(deviceId) {
    return [...this.commands.values()].filter((c) => c.device_id === deviceId && c.status === 'pending');
  }

  create({ device, ip }) {
    const pending = this.pendingFor(device.id);
    if (pending.length >= MAX_PENDING_PER_DEVICE) {
      return { error: '这台电脑还有排队的截屏请求，等它处理完再试', status: 409 };
    }
    const now = Date.now();
    const command = {
      id: `${now.toString(36)}-${crypto.randomBytes(6).toString('hex')}`,
      device_id: device.id,
      device_name: device.name,
      kind: 'screenshot',
      status: 'pending',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + APPROVAL_TIMEOUT_MS).toISOString(),
      acked_at: null,
      decided_at: null,
      error: '',
      ip: String(ip || ''),
      screenshot_id: null,
      queue_position: pending.length + 1,
    };
    this.commands.set(command.id, command);
    this.armTimeout(command, APPROVAL_TIMEOUT_MS);

    // 电脑正在长轮询 → 立刻投递，无需等下一次请求
    const waiters = this.waiters.get(command.device_id);
    if (waiters && waiters.length) {
      const next = waiters.shift();
      if (!waiters.length) this.waiters.delete(command.device_id);
      next(command);
    }
    this.trimCommands();
    return { command };
  }

  armTimeout(command, delayMs) {
    const old = this.timers.get(command.id);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.timers.delete(command.id);
      if (command.status !== 'pending') return;
      this.finish(command, 'timeout', { error: '电脑 20 秒内没有处理，已自动拒绝' });
    }, delayMs);
    if (timer.unref) timer.unref();
    this.timers.set(command.id, timer);
  }

  /** 电脑收到指令后立刻回执，把 20 秒审批计时换成「截屏上传」宽限。 */
  ack(id, deviceId) {
    const command = this.commands.get(String(id || ''));
    if (!command || command.device_id !== deviceId) return null;
    if (command.status !== 'pending') return command;
    command.acked_at = new Date().toISOString();
    command.expires_at = new Date(Date.now() + ACK_GRACE_MS).toISOString();
    this.armTimeout(command, ACK_GRACE_MS);
    this.onChange(command);
    return command;
  }

  finish(command, status, extra = {}) {
    const timer = this.timers.get(command.id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(command.id);
    }
    if (command.status !== 'pending') return command; // 已超时或已处理，后到的回执忽略
    command.status = status;
    command.decided_at = new Date().toISOString();
    if (extra.error) command.error = String(extra.error).slice(0, 128);
    if (extra.screenshot_id) command.screenshot_id = extra.screenshot_id;
    this.onChange(command);
    return command;
  }

  get(id) {
    return this.commands.get(String(id || '')) || null;
  }

  /** 长轮询：有排队指令立即返回，否则挂起到超时（返回 null）。 */
  waitFor(deviceId, timeoutMs) {
    const pending = this.pendingFor(deviceId);
    if (pending.length) return Promise.resolve(pending[0]);
    return new Promise((resolve) => {
      let settled = false;
      // 挂起的等待者必须从队列里摘掉，否则超时后残留的旧等待者会吞掉新指令，
      // 表现为「指令要等这一轮长轮询超时后才能到电脑」。
      const remove = () => {
        const cur = this.waiters.get(deviceId);
        if (!cur) return;
        const idx = cur.indexOf(done);
        if (idx >= 0) cur.splice(idx, 1);
        if (!cur.length) this.waiters.delete(deviceId);
      };
      const done = (command) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        remove();
        resolve(command || null);
      };
      const timer = setTimeout(() => done(null), Math.max(1, timeoutMs));
      if (timer.unref) timer.unref();
      const list = this.waiters.get(deviceId) || [];
      list.push(done);
      this.waiters.set(deviceId, list);
    });
  }

  // ── 截图存储 ─────────────────────────────────────────────────────────
  addScreenshot({ device, commandId, buffer, width, height }) {
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
    fs.writeFileSync(this.pathFor(id), buffer);
    const shot = {
      id,
      command_id: commandId,
      device_id: device.id,
      device_name: device.name,
      created_at: new Date().toISOString(),
      width: Number(width) || 0,
      height: Number(height) || 0,
      bytes: buffer.length,
      url: `/api/screenshot/${id}`,
    };
    this.screenshots.unshift(shot);
    while (this.screenshots.length > INDEX_LIMIT) {
      const dropped = this.screenshots.pop();
      this.removeFile(dropped.id);
    }
    this.saveIndex();
    return shot;
  }

  listScreenshots(limit = 20) {
    this.prune();
    return this.screenshots.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  readScreenshot(id) {
    if (!/^[a-z0-9-]+$/i.test(String(id || ''))) return null;
    const file = this.pathFor(id);
    try {
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  clearDevice(deviceId) {
    for (const shot of this.screenshots) {
      if (shot.device_id === deviceId) this.removeFile(shot.id);
    }
    this.screenshots = this.screenshots.filter((s) => s.device_id !== deviceId);
    this.saveIndex();
  }

  clearAll() {
    for (const shot of this.screenshots) this.removeFile(shot.id);
    this.screenshots = [];
    this.saveIndex();
  }

  /** 只保留最近 300 条指令记录，防止长时间运行内存膨胀。 */
  trimCommands() {
    if (this.commands.size <= 300) return;
    for (const [id, command] of this.commands) {
      if (command.status === 'pending') continue;
      this.commands.delete(id);
      const timer = this.timers.get(id);
      if (timer) clearTimeout(timer);
      this.timers.delete(id);
      if (this.commands.size <= 200) break;
    }
  }

  publicCommand(command) {
    if (!command) return null;
    return {
      id: command.id,
      device_id: command.device_id,
      device_name: command.device_name,
      kind: command.kind,
      status: command.status,
      created_at: command.created_at,
      expires_at: command.expires_at,
      acked_at: command.acked_at,
      decided_at: command.decided_at,
      error: command.error,
      queue_position: command.queue_position,
      screenshot_id: command.screenshot_id,
      screenshot_url: command.screenshot_id ? `/api/screenshot/${command.screenshot_id}` : null,
    };
  }
}

module.exports = { CommandQueue, MAX_IMAGE_BYTES };
