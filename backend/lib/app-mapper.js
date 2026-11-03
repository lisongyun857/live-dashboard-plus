'use strict';

// 应用名映射：内置一小份常见应用，映射不到时优先使用上报方提供的 app_label
const APP_NAMES = {
  android: {
    'com.tencent.mm': '微信',
    'com.tencent.mobileqq': 'QQ',
    'com.tencent.tmgp.sgame': '王者荣耀',
    'com.tencent.tmgp.pubgmhd': '和平精英',
    'com.ss.android.ugc.aweme': '抖音',
    'com.smile.gifmaker': '快手',
    'com.xingin.xhs': '小红书',
    'com.taobao.taobao': '淘宝',
    'com.jd.jrapp': '京东',
    'com.eg.android.alipaygphone': '支付宝',
    'com.netease.cloudmusic': '网易云音乐',
    'com.tencent.qqmusic': 'QQ音乐',
    'tv.danmaku.bili': '哔哩哔哩',
    'com.tencent.qqlive': '腾讯视频',
    'com.qiyi.video': '爱奇艺',
    'com.youku.phone': '优酷',
    'com.ss.android.article.news': '今日头条',
    'com.sina.weibo': '微博',
    'com.zhihu.android': '知乎',
    'com.baidu.tieba': '百度贴吧',
    'com.tencent.wework': '企业微信',
    'com.alibaba.android.rimet': '钉钉',
    'com.google.android.youtube': 'YouTube',
    'com.android.chrome': 'Chrome',
    'com.microsoft.emmx': 'Edge',
    'com.android.settings': '设置',
    'com.android.camera': '相机',
    'com.miui.gallery': '相册',
    'com.miui.notes': '笔记',
    'com.miui.home': '桌面',
    'com.android.systemui': '系统界面',
    'com.quark.browser': '夸克',
    'com.UCMobile': 'UC 浏览器',
    'com.android.vending': 'Google Play',
    'com.spotify.music': 'Spotify',
    'com.discord': 'Discord',
    'org.telegram.messenger': 'Telegram',
    'com.whatsapp': 'WhatsApp',
    'com.instagram.android': 'Instagram',
  },
  windows: {
    'chrome.exe': 'Chrome',
    'msedge.exe': 'Edge',
    'firefox.exe': 'Firefox',
    'code.exe': 'Visual Studio Code',
    'devenv.exe': 'Visual Studio',
    'idea64.exe': 'IntelliJ IDEA',
    'pycharm64.exe': 'PyCharm',
    'wechat.exe': '微信',
    'qq.exe': 'QQ',
    'tim.exe': 'TIM',
    'dingtalk.exe': '钉钉',
    'steam.exe': 'Steam',
    'spotify.exe': 'Spotify',
    'qqmusic.exe': 'QQ音乐',
    'cloudmusic.exe': '网易云音乐',
    'bilibili.exe': '哔哩哔哩',
    'explorer.exe': '文件资源管理器',
    'notepad.exe': '记事本',
    'windows terminal.exe': 'Windows Terminal',
    'powershell.exe': 'PowerShell',
    'bash.exe': 'Bash',
    'excel.exe': 'Excel',
    'winword.exe': 'Word',
    'powerpnt.exe': 'PowerPoint',
    'photoshop.exe': 'Photoshop',
    'illustrator.exe': 'Illustrator',
    'obs64.exe': 'OBS Studio',
    'discord.exe': 'Discord',
    'telegram.exe': 'Telegram',
    'javaw.exe': 'Java 应用',
  },
  macos: {
    'google chrome': 'Chrome',
    'safari': 'Safari',
    'visual studio code': 'Visual Studio Code',
    'wechat': '微信',
    'qq': 'QQ',
    'steam': 'Steam',
    'spotify': 'Spotify',
    'finder': '访达',
    'terminal': '终端',
  },
  linux: {
    'firefox': 'Firefox',
    'chromium': 'Chromium',
    'code': 'Visual Studio Code',
    'chrome': 'Chrome',
    'nautilus': '文件管理器',
    'org.mozilla.firefox': 'Firefox',
  },
  ios: {
    'com.tencent.xin': '微信',
    'com.tencent.mqq': 'QQ',
    'com.bilibili.bilibili': '哔哩哔哩',
    'com.zhihu.ios': '知乎',
    'com.ss.iphone.ugc.aweme': '抖音',
  },
};

// 常见应用的文案；映射不到时按分类兜底
const STATUS_TEXTS = {
  微信: '正在和重要的人聊天喵~',
  QQ: 'QQ 消息叮咚响个不停~',
  微信小程序: '正在小程序里逛来逛去~',
  Chrome: '正在网上冲浪喵~',
  Edge: '正在网上冲浪喵~',
  哔哩哔哩: '正在 B 站追视频喵~',
  抖音: '刷抖音，一不小心就停不下来了…',
  快手: '正在刷快手~',
  小红书: '正在小红书做攻略喵~',
  'Visual Studio Code': '正在敲代码，bug 退散！',
  'IntelliJ IDEA': '正在写 Java，认真脸。',
  PyCharm: '正在写 Python，认真脸。',
  Steam: '正在 Steam 逛游戏~',
  王者荣耀: '正在王者峡谷征战！',
  和平精英: '正在吃鸡，别打扰！',
  网易云音乐: '正在听网易云，单曲循环中~',
  QQ音乐: '正在听歌，心情不错喵~',
  Spotify: '正在听 Spotify~',
  YouTube: '正在 YouTube 看视频~',
  腾讯视频: '正在追剧喵~',
  爱奇艺: '正在追剧喵~',
  淘宝: '正在淘宝买买买~',
  京东: '正在京东挑东西~',
  支付宝: '正在处理一些私密的事情喵~',
  知乎: '正在知乎看回答~',
  微博: '正在刷微博吃瓜~',
  '文件资源管理器': '正在翻找文件喵~',
  记事本: '正在记点什么~',
  Excel: '正在和表格大战三百回合。',
  Word: '正在写文档喵~',
  'Windows Terminal': '正在终端里敲命令~',
  PowerShell: '正在终端里敲命令~',
  'OBS Studio': '正在准备录屏~',
};

const SECRET_NAME = '私密应用';
const SECRET_STATUS = '正在处理一些私密的事情喵~';

// 金融、密码、政务类应用整体匿名化：只保留时长，不留应用名
const SECRET_KEYWORDS = [
  /银行/i, /bank/i, /支付/i, /支付寶/i, /钱包/i, /wallet/i,
  /密码/i, /password/i, /keepass/i, /1password/i, /bitwarden/i, /lastpass/i,
  /authenticator/i, /验证器/i, /动态口令/i, /证券/i, /券商/i, /基金/i,
  /理财/i, /保险/i, /政务/i, /医保/i, /社保/i, /身份证/i, /云闪付/i,
  /掌上生活/i, /数字人民币/i,
];

// 这些分类的窗口标题默认不公开
const HIDE_TITLE_KEYWORDS = [
  '微信', 'QQ', '钉钉', '企业微信', '邮件', 'mail', 'outlook', '短信', 'messages',
  '银行', '支付', '钱包', '密码', '验证器', '证券', '政务', '医保', '社保',
];

function normalizePlatform(platform) {
  const p = String(platform || '').toLowerCase();
  return ['windows', 'android', 'macos', 'linux', 'ios'].includes(p) ? p : null;
}

function sanitizeLabel(label) {
  if (typeof label !== 'string') return undefined;
  const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
  return cleaned || undefined;
}

function isSecretApp(name) {
  if (!name) return false;
  if (name === SECRET_NAME) return true;
  return SECRET_KEYWORDS.some((re) => re.test(name));
}

function resolveAppName(appId, platform, label) {
  const p = normalizePlatform(platform);
  const lower = String(appId || '').toLowerCase();
  if (appId === 'private') return SECRET_NAME;
  if (!lower) return '未知应用';
  const table = p ? APP_NAMES[p] : undefined;
  if (table) {
    for (const [key, value] of Object.entries(table)) {
      if (key.toLowerCase() === lower) return value;
    }
  }
  if (label) return label;
  if (p === 'windows' && lower.endsWith('.exe')) return appId.slice(0, -4);
  if (lower.includes('.') && (p === 'android' || p === 'ios')) {
    const last = lower.split('.').pop() || lower;
    return last.charAt(0).toUpperCase() + last.slice(1);
  }
  return appId;
}

function guessCategory(appName) {
  const name = String(appName || '').toLowerCase();
  const rules = [
    [/bilibili|哔哩|youtube|视频|爱奇艺|优酷|腾讯视频|netflix|播放器|mpv|vlc/, 'video'],
    [/音乐|music|spotify|cloudmusic|网易云|qq音乐|听歌/, 'music'],
    [/游戏|game|steam|王者|荣耀|和平精英|原神|minecraft|英雄联盟/, 'game'],
    [/code|idea|pycharm|visual studio|terminal|powershell|bash|vim|编辑器|开发|sublime/, 'code'],
    [/chrome|edge|firefox|safari|browser|浏览器|夸克|uc/, 'browser'],
    [/微信|qq|dingtalk|钉钉|telegram|discord|whatsapp|聊天|短信|message|mail|邮件/, 'chat'],
    [/淘宝|taobao|京东|jd|购物|shop|小红书|闲鱼/, 'shopping'],
    [/word|excel|powerpoint|文档|office|wps|笔记|notes/, 'office'],
  ];
  for (const [re, category] of rules) {
    if (re.test(name)) return category;
  }
  return 'default';
}

const CATEGORY_TEXTS = {
  video: '正在看视频喵~',
  music: '正在听歌喵~',
  game: '正在打游戏，勿扰！',
  code: '正在敲代码，bug 退散！',
  browser: '正在网上冲浪喵~',
  chat: '正在聊天喵~',
  shopping: '正在买买买~',
  office: '正在处理文档喵~',
  default: '',
};

function getStatusText(appName) {
  if (!appName) return '等待第一次上报…';
  const direct = STATUS_TEXTS[appName];
  if (direct) return direct;
  const category = guessCategory(appName);
  const generic = CATEGORY_TEXTS[category];
  if (generic) return generic;
  return `正在用 ${appName} 喵~`;
}

function shouldHideTitle(appName, appId) {
  const haystack = `${appName} ${appId}`.toLowerCase();
  return HIDE_TITLE_KEYWORDS.some((word) => haystack.includes(String(word).toLowerCase()));
}

/**
 * 生成可以公开显示的标题（原文永不落库）。
 * 聊天/邮件/金融类应用不公开标题；其余去除应用名后缀并截断。
 */
function processDisplayTitle(appName, windowTitle) {
  if (typeof windowTitle !== 'string' || !windowTitle) return '';
  if (shouldHideTitle(appName, '')) return '';
  let title = windowTitle.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  if (appName) {
    const suffix = ` - ${appName}`;
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) {
      title = title.slice(0, -suffix.length).trim();
    }
  }
  if (title.length > 80) title = `${title.slice(0, 78)}…`;
  return title;
}

/** 解析应用展示信息；私密应用在这里直接匿名化。 */
function resolveAppMeta(appId, platform, label, windowTitle) {
  const name = resolveAppName(appId, platform, sanitizeLabel(label));
  if (!name || isSecretApp(name) || appId === 'private') {
    return {
      appName: SECRET_NAME,
      statusText: SECRET_STATUS,
      secret: true,
      effectiveAppId: 'private',
      displayTitle: '',
    };
  }
  return {
    appName: name,
    statusText: getStatusText(name),
    secret: false,
    effectiveAppId: String(appId),
    displayTitle: processDisplayTitle(name, windowTitle),
  };
}

module.exports = {
  resolveAppName,
  resolveAppMeta,
  getStatusText,
  processDisplayTitle,
  isSecretApp,
  SECRET_NAME,
  SECRET_STATUS,
};
