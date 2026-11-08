'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ACTIVITIES = 8000;

class Store {
  constructor({ file, retentionDays }) {
    this.file = file;
    this.retentionDays = retentionDays;
    this.state = { activities: [], devices: {}, nextId: 1 };
    this.lastKeys = new Map();
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = {
        activities: Array.isArray(raw.activities) ? raw.activities : [],
        devices: raw.devices && typeof raw.devices === 'object' ? raw.devices : {},
        nextId: Number(raw.nextId) || 1,
      };
    } catch (err) {
      console.warn(`[store] 读取数据失败（将以空数据启动）：${err.message}`);
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 700);
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[store] 保存数据失败：${err.message}`);
    }
  }

  prune() {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    this.state.activities = this.state.activities.filter((a) => {
      const t = Date.parse(a.started_at);
      return Number.isFinite(t) && t >= cutoff;
    });
    if (this.state.activities.length > MAX_ACTIVITIES) {
      this.state.activities = this.state.activities.slice(-MAX_ACTIVITIES);
    }
  }

  /**
   * 写入一次上报。同一设备 10 秒内重复上报同一应用只记一条活动，但状态总是刷新。
   */
  report({ device, appId, appName, displayTitle, startedAt, extra, screenOn = true, recordActivity = true }) {
    const bucket = Math.floor(Date.now() / 10000);
    // 屏幕开关也算一次边界，避免刚切应用就息屏时丢掉这一段的结束时间
    const dedupeKey = `${device.id}|${appId}|${bucket}|${screenOn ? 1 : 0}`;
    let recorded = false;

    if (recordActivity && this.lastKeys.get(device.id) !== dedupeKey) {
      this.lastKeys.set(device.id, dedupeKey);
      this.state.activities.push({
        id: this.state.nextId++,
        device_id: device.id,
        platform: device.platform,
        app_id: appId,
        app_name: appName,
        display_title: displayTitle || '',
        started_at: startedAt,
        screen_on: screenOn !== false,
      });
      recorded = true;
      this.prune();
    }

    this.state.devices[device.id] = {
      device_id: device.id,
      app_id: appId,
      app_name: appName,
      display_title: displayTitle || '',
      last_seen_at: new Date().toISOString(),
      screen_on: screenOn !== false,
      extra: extra || {},
    };

    this.scheduleSave();
    return { recorded };
  }

  getDevice(deviceId) {
    return this.state.devices[deviceId] || null;
  }

  setRetentionDays(days) {
    const n = Math.max(1, Number(days) || 7);
    if (n !== this.retentionDays) {
      this.retentionDays = n;
      this.prune();
      this.scheduleSave();
    }
  }

  clearDevice(deviceId) {
    this.state.activities = this.state.activities.filter((a) => a.device_id !== deviceId);
    delete this.state.devices[deviceId];
    this.scheduleSave();
  }

  clearAll() {
    this.state.activities = [];
    this.state.devices = {};
    this.lastKeys.clear();
    this.scheduleSave();
  }

  stats() {
    const times = this.state.activities
      .map((a) => Date.parse(a.started_at))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let fileBytes = 0;
    try {
      fileBytes = fs.statSync(this.file).size;
    } catch {
      // 文件还不存在
    }
    return {
      activity_count: this.state.activities.length,
      oldest_at: times.length ? new Date(times[0]).toISOString() : null,
      file_kb: Math.round(fileBytes / 1024),
    };
  }

  recentActivities(limit = 20) {
    return this.state.activities
      .slice(-limit)
      .reverse()
      .map((a) => ({ ...a }));
  }

  /** 查询某时间范围内的活动，按设备拼成时间线片段。 */
  timeline(startIso, endIso, deviceId) {
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    const activities = this.state.activities
      .filter((a) => {
        if (deviceId && a.device_id !== deviceId) return false;
        const t = Date.parse(a.started_at);
        return Number.isFinite(t) && t >= startMs && t < endMs;
      })
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));

    // 每个设备的下一条活动，用于计算持续时长
    const nextByDevice = new Map();
    const nextStarts = new Array(activities.length).fill(null);
    const nextScreenOff = new Array(activities.length).fill(false);
    for (let i = activities.length - 1; i >= 0; i -= 1) {
      const a = activities[i];
      const next = nextByDevice.get(a.device_id) || null;
      nextStarts[i] = next ? next.started_at : null;
      nextScreenOff[i] = Boolean(next && next.screen_on === false);
      nextByDevice.set(a.device_id, a);
    }

    const GAP_THRESHOLD_MS = 2 * 60 * 1000;
    const now = Date.now();
    const segments = [];

    for (let i = 0; i < activities.length; i += 1) {
      const a = activities[i];
      const start = Date.parse(a.started_at);
      if (!Number.isFinite(start)) continue;
      const screenOn = a.screen_on !== false;

      const next = nextStarts[i];
      let end = next ? Date.parse(next) : Math.min(now, endMs);
      let endedAt = next || (end > start ? new Date(end).toISOString() : null);

      // 下一条就是明确的息屏边界时，这段使用时长要完整计入；否则超长空档按 1 分钟估算
      if (screenOn && !nextScreenOff[i] && end - start > GAP_THRESHOLD_MS) {
        end = start + 60 * 1000;
        endedAt = new Date(end).toISOString();
      }
      if (end < start) end = start;

      segments.push({
        app_id: a.app_id,
        app_name: a.app_name,
        display_title: a.display_title || '',
        started_at: a.started_at,
        ended_at: endedAt,
        // 息屏时段只作为时间线里的一个灰条，不计入使用时长
        duration_minutes: screenOn ? Math.round((end - start) / 60000) : 0,
        screen_on: screenOn,
        device_id: a.device_id,
        platform: a.platform,
      });
    }

    const summary = {};
    for (const s of segments) {
      if (!s.screen_on) continue;
      if (!summary[s.device_id]) summary[s.device_id] = {};
      summary[s.device_id][s.app_name] = (summary[s.device_id][s.app_name] || 0) + s.duration_minutes;
    }

    return { segments, summary };
  }
}

module.exports = { Store };
