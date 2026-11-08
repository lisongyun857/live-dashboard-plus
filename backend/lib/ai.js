'use strict';

// 只按「接口协议」适配，不绑定具体厂商：API 地址、模型、Key 都由用户在管理面板里填。
// OpenAI 兼容协议覆盖 DeepSeek / Kimi / 智谱 / 通义 / 硅基流动 / Groq / OpenRouter / Ollama / 各类中转站。
const PROTOCOLS = {
  openai: {
    label: 'OpenAI 兼容（/chat/completions）',
    hint: '地址填到 /v1 为止，例如 https://api.deepseek.com/v1、https://api.moonshot.cn/v1、https://open.bigmodel.cn/api/paas/v4、https://dashscope.aliyuncs.com/compatible-mode/v1、https://api.siliconflow.cn/v1、https://api.groq.com/openai/v1、https://openrouter.ai/api/v1。也支持任意中转站地址。',
    base_url: '',
    model: '',
    no_key: false,
  },
  ollama: {
    label: 'Ollama 本地（OpenAI 兼容，无需 Key）',
    hint: '默认 http://127.0.0.1:11434/v1，模型例如 qwen2.5:7b。注意：后端跑在服务器上时，127.0.0.1 指的是服务器本机。',
    base_url: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    no_key: true,
  },
  anthropic: {
    label: 'Anthropic Claude（/messages）',
    hint: '地址默认 https://api.anthropic.com/v1，模型例如 claude-3-5-sonnet-latest。',
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-latest',
    no_key: false,
  },
  gemini: {
    label: 'Google Gemini（generateContent）',
    hint: '地址默认 https://generativelanguage.googleapis.com/v1beta，模型例如 gemini-2.0-flash。',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
    no_key: false,
  },
};

const SYSTEM_PROMPT = `你是「视监面板」的 AI 助手，负责根据设备当天的应用使用记录写一段简短的个人使用总结。
要求：
1. 用中文，120-200 字，分成 2-3 段或要点；
2. 指出使用时长最多的应用和大致占比，以及集中在什么时段；
3. 结合当天电量与充电情况，给出充电习惯或休息方面的提醒；
4. 语气客观友好，不要编造数据里没有的内容；数据太少时直接说明数据不足。
直接输出总结正文，不要加“总结：”之类的标题，不要输出 JSON。`;

function protocolMeta(protocol) {
  return PROTOCOLS[protocol] || PROTOCOLS.openai;
}

function protocolList() {
  return Object.entries(PROTOCOLS).map(([key, value]) => ({
    key,
    label: value.label,
    hint: value.hint,
    base_url: value.base_url,
    model: value.model,
    no_key: Boolean(value.no_key),
  }));
}

async function requestJson(url, { headers, body, timeoutMs = 45000 }) {
  if (typeof fetch !== 'function') {
    throw new Error('当前 Node.js 版本没有内置 fetch，请升级到 18 或更高版本');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const raw = data && (data.error || data.message) ? data.error || data.message : text;
      const detail = typeof raw === 'string' ? raw : raw.message || JSON.stringify(raw);
      throw new Error(`HTTP ${res.status}：${String(detail).slice(0, 200)}`);
    }
    if (!data) throw new Error(`返回内容不是 JSON：${text.slice(0, 120)}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时（45 秒），请检查服务器网络或 API 地址');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function textOf(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part === 'string' ? part : part && part.text ? part.text : ''))
    .filter(Boolean)
    .join('');
}

async function generate({ ai, prompt, timeoutMs }) {
  const protocol = PROTOCOLS[ai.protocol] ? ai.protocol : 'openai';
  const meta = PROTOCOLS[protocol];
  const base = String(ai.base_url || meta.base_url || '').replace(/\/+$/, '');
  const model = String(ai.model || meta.model || '').trim();
  const key = String(ai.api_key || '').trim();
  const temperature = Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.4;
  const maxTokens = Number.isFinite(Number(ai.max_tokens)) ? Number(ai.max_tokens) : 600;

  if (!base) throw new Error('没有填 API 地址');
  if (!model) throw new Error('没有填模型名称');
  if (!meta.no_key && !key) throw new Error('没有填 API Key');

  if (protocol === 'anthropic') {
    const data = await requestJson(`${base}/messages`, {
      timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: maxTokens,
        temperature,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      },
    });
    return textOf(data.content);
  }

  if (protocol === 'gemini') {
    const data = await requestJson(
      `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        timeoutMs,
        headers: { 'Content-Type': 'application/json' },
        body: {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        },
      }
    );
    const candidate = data.candidates && data.candidates[0];
    return textOf(candidate && candidate.content ? candidate.content.parts : []);
  }

  // OpenAI 兼容协议（含 Ollama）
  const data = await requestJson(`${base}/chat/completions`, {
    timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    },
  });
  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (typeof message.content === 'string') return message.content;
  return textOf(message.content);
}

/** 把结构化统计转成给模型看的提示词 */
function buildPrompt(stats) {
  const lines = [];
  lines.push(`日期：${stats.date}`);
  lines.push(`设备：${stats.device_name || '全部设备'}`);
  lines.push(`累计使用：${stats.total_minutes} 分钟，共涉及 ${stats.app_count} 个应用`);
  if (stats.sleep_minutes) lines.push(`息屏时长：${stats.sleep_minutes} 分钟（不计入使用）`);
  if (stats.charging_minutes) lines.push(`充电时长：${stats.charging_minutes} 分钟`);
  if (stats.battery && stats.battery.start_percent !== null) {
    const b = stats.battery;
    const trend = [];
    trend.push(`开始时 ${b.start_percent}%`);
    trend.push(`结束时 ${b.end_percent}%`);
    trend.push(`最低 ${b.min_percent}%`);
    trend.push(`最高 ${b.max_percent}%`);
    lines.push(`电量：${trend.join('，')}`);
  }
  if (stats.ranking.length) {
    lines.push('应用排行：');
    for (const item of stats.ranking.slice(0, 8)) {
      lines.push(`- ${item.app_name}：${item.minutes} 分钟（${item.share}%）`);
    }
  } else {
    lines.push('应用排行：这一天没有任何使用记录。');
  }
  return lines.join('\n');
}

module.exports = { PROTOCOLS, protocolMeta, protocolList, generate, buildPrompt };
