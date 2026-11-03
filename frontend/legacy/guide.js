'use strict';

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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function bindCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = document.getElementById(btn.dataset.copyTarget);
      if (!target) return;
      const ok = await copyText(target.textContent.trim());
      btn.textContent = ok ? '已复制' : '复制失败';
      btn.classList.toggle('is-copied', ok);
      setTimeout(() => {
        btn.textContent = '复制';
        btn.classList.remove('is-copied');
      }, 1600);
    });
  });
}

async function fillEndpoint() {
  let reportUrl = `${window.location.origin}/api/report`;
  try {
    const config = await fetch('/api/config', { headers: { Accept: 'application/json' } }).then((r) => r.json());
    if (config.report_url) reportUrl = config.report_url;
  } catch {
    // 用当前地址兜底
  }
  const endpoint = document.getElementById('endpoint');
  endpoint.textContent = reportUrl;

  const curl = document.getElementById('curl');
  curl.textContent = `curl -X POST "${reportUrl}" \\
  -H "Authorization: Bearer <手机令牌>" \\
  -H "Content-Type: application/json" \\
  -d '{"app_id":"com.tencent.mm","app_label":"微信","battery_percent":73}'`;
}

function bindTestForm() {
  const form = document.getElementById('test-form');
  const result = document.getElementById('test-result');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = document.getElementById('token-input').value.trim();
    const appId = document.getElementById('app-id-input').value.trim();
    const appLabel = document.getElementById('app-label-input').value.trim();
    const battery = Number(document.getElementById('battery-input').value);

    if (!token) {
      result.className = 'test-result bad';
      result.textContent = '请先填手机令牌。';
      return;
    }
    if (!appId) {
      result.className = 'test-result bad';
      result.textContent = 'app_id 不能为空。';
      return;
    }

    const payload = { app_id: appId };
    if (appLabel) payload.app_label = appLabel;
    if (Number.isFinite(battery)) payload.battery_percent = Math.max(0, Math.min(100, battery));

    result.className = 'test-result';
    result.textContent = '发送中…';

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        result.className = 'test-result ok';
        result.textContent = `上报成功：${data.app_name || appId}（${data.status_text || ''}）`;
        setTimeout(() => { window.location.href = '/'; }, 1200);
      } else {
        result.className = 'test-result bad';
        result.textContent = `上报失败（${res.status}）：${data.error || '未知错误'}`;
      }
    } catch (err) {
      result.className = 'test-result bad';
      result.textContent = `网络错误：${err.message}`;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  bindCopyButtons();
  fillEndpoint();
  bindTestForm();
});
