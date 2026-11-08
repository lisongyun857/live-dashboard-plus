'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把 YYYY-MM-DD + 时区偏移（分钟，东八区为 -480）换算成本地一天的毫秒区间。
 * 与 /api/timeline 的算法保持一致。
 */
function dayWindow(date, tzRaw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!match) return { error: 'date 参数格式应为 YYYY-MM-DD' };
  const tz = Number.isFinite(tzRaw) ? tzRaw : 0;
  if (tz < -840 || tz > 840) return { error: 'tz 参数无效' };

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
  return { startMs, endMs: startMs + DAY_MS, tz, date };
}

function localDate(startMs, tz) {
  return new Date(startMs - tz * 60000).toISOString().slice(0, 10);
}

/** 电量曲线：采样点 + 充电区间 + 首尾/最低/最高电量 */
function batterySummary(samples, startMs, endMs) {
  const points = samples
    .map((s) => ({
      t: s.at,
      percent: Number(s.percent),
      charging: s.charging === true || s.charging === false ? s.charging : null,
    }))
    .filter((s) => Number.isFinite(s.percent));

  const charging = [];
  let openAt = null;
  for (const point of points) {
    if (point.charging === true && !openAt) {
      openAt = point.t;
    } else if (point.charging === false && openAt) {
      charging.push({ started_at: openAt, ended_at: point.t });
      openAt = null;
    }
  }
  if (openAt) charging.push({ started_at: openAt, ended_at: null });

  let chargingMinutes = 0;
  for (const seg of charging) {
    const start = Date.parse(seg.started_at);
    const end = seg.ended_at ? Date.parse(seg.ended_at) : Math.min(Date.now(), endMs);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      chargingMinutes += Math.round((end - start) / 60000);
    }
  }

  const percents = points.map((p) => p.percent);
  return {
    samples: points,
    charging,
    charging_minutes: chargingMinutes,
    start_percent: percents.length ? percents[0] : null,
    end_percent: percents.length ? percents[percents.length - 1] : null,
    min_percent: percents.length ? Math.min(...percents) : null,
    max_percent: percents.length ? Math.max(...percents) : null,
  };
}

/** 近 N 天每天的使用分钟数（不含息屏），按时间正序 */
function heatmap(store, { dayStart, tz, days, deviceId }) {
  const list = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const startMs = dayStart - i * DAY_MS;
    const result = store.timeline(new Date(startMs).toISOString(), new Date(startMs + DAY_MS).toISOString(), deviceId || null);
    let minutes = 0;
    for (const summary of Object.values(result.summary)) {
      for (const value of Object.values(summary)) minutes += value;
    }
    list.push({ date: localDate(startMs, tz), minutes });
  }
  return list;
}

module.exports = { DAY_MS, dayWindow, batterySummary, heatmap, localDate };
