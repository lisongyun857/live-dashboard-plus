'use strict';

const crypto = require('node:crypto');

// 管理密码只存 scrypt 哈希，格式：scrypt$<salt base64>$<hash base64>
// 参数 N=16384 / r=8 / p=1，单次约 16MB 内存、几十毫秒，足以抵抗离线爆破
const SCHEME = 'scrypt';
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, KEY_LEN, PARAMS);
  return `${SCHEME}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith(`${SCHEME}$`);
}

function verifyPassword(plain, stored) {
  if (!isPasswordHash(stored)) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3) return false;
  let salt;
  let expect;
  try {
    salt = Buffer.from(parts[1], 'base64');
    expect = Buffer.from(parts[2], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expect.length === 0) return false;
  const actual = crypto.scryptSync(String(plain), salt, expect.length, PARAMS);
  return actual.length === expect.length && crypto.timingSafeEqual(actual, expect);
}

module.exports = { hashPassword, isPasswordHash, verifyPassword };
