'use strict';

// 在服务器上重置管理面板密码：
//   node reset-password.js            # 生成随机新密码
//   node reset-password.js 新密码      # 使用指定密码（至少 6 位）
// 执行后需要重启后端服务（宝塔 Node 项目里点「重启」）才会生效。

const fs = require('node:fs');
const crypto = require('node:crypto');

const { hashPassword } = require('./lib/password');
const { CONFIG_PATH } = require('./lib/config');

const input = (process.argv[2] || '').trim();
const plain = input || crypto.randomBytes(16).toString('hex');

if (plain.length < 6) {
  console.error('密码至少 6 位');
  process.exit(1);
}

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`找不到配置文件：${CONFIG_PATH}`);
  console.error('请先启动一次后端，让它自动生成 config.json');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error(`config.json 解析失败：${err.message}`);
  process.exit(1);
}

cfg.admin_password = hashPassword(plain);

const tmp = `${CONFIG_PATH}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
fs.renameSync(tmp, CONFIG_PATH);

console.log('[reset] 管理密码已更新（config.json 中只保存 scrypt 哈希）');
console.log(`[reset] 新密码：${plain}`);
console.log('[reset] 请重启后端服务后使用新密码登录 /admin');
