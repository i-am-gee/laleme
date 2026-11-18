// 拉了么服务端 M1：账号 + 记录同步
// 运行在微信云托管：用户身份由平台注入的 X-WX-OPENID 头提供，不要自己解析登录态。

import http from 'node:http';
import { openDb } from './db.js';
import { exchangeCode, openidFromRequest, signToken } from './auth.js';

const PORT = Number(process.env.PORT || 80);
const ALLOW_DEBUG_AUTH = process.env.ALLOW_DEBUG_AUTH === '1';
const MAX_BODY = 1024 * 1024; // 1MB，一次最多 200 条记录足够

const MOODS = new Set(['good', 'normal', 'hard']);
const COLORS = new Set(['brown', 'dark', 'tan', 'green', 'black', 'red']);

let db;

/* ---------------------------- 工具 ---------------------------- */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function fail(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// 身份只从签名令牌取；debug 头仅在 ALLOW_DEBUG_AUTH=1 时可用。
// 直接信任 X-WX-OPENID 这类头在自建服务器上是越权漏洞，已移除。
function openidOf(req) {
  return openidFromRequest(req, ALLOW_DEBUG_AUTH);
}

// 单条记录的字段校验：宁可拒收，也不要让脏数据进库
function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const clientId = String(raw.clientId || '').trim();
  const ts = Number(raw.ts);
  const durationMin = Number(raw.durationMin);
  const updatedAt = Number(raw.updatedAt || Date.now());
  if (!clientId || clientId.length > 64) {
    return null;
  }
  if (!Number.isFinite(ts) || ts <= 0) {
    return null;
  }
  if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 720) {
    return null;
  }
  const bristol = raw.bristol === null || raw.bristol === undefined ? null : Number(raw.bristol);
  if (bristol !== null && !(bristol >= 1 && bristol <= 7)) {
    return null;
  }
  const mood = raw.mood ?? null;
  if (mood !== null && !MOODS.has(mood)) {
    return null;
  }
  const color = raw.color ?? null;
  if (color !== null && !COLORS.has(color)) {
    return null;
  }
  return {
    clientId,
    ts: Math.floor(ts),
    durationMin: Math.floor(durationMin),
    bristol,
    mood,
    color,
    deleted: !!raw.deleted,
    updatedAt: Math.floor(updatedAt),
  };
}

/* ---------------------------- 路由 ---------------------------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health') {
    send(res, 200, { ok: true, driver: db.driver, now: Date.now() });
    return;
  }

  // 登录：code 换 openid → 建档 → 发令牌。这是唯一不需要令牌的写接口。
  if (path === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const code = String(body.code || '').trim();
    if (!code) {
      fail(res, 400, 'missing_code', '缺少登录 code');
      return;
    }
    // 本地联调允许 debug:<openid> 跳过微信换码，生产环境该开关默认关闭
    const openid = ALLOW_DEBUG_AUTH && code.startsWith('debug:')
      ? code.slice(6)
      : await exchangeCode(code);
    const profile = await db.upsertUser(openid, {
      nick: body.nick,
      avatar: body.avatar,
      settings: body.settings,
    });
    const count = await db.countRecords(openid);
    send(res, 200, { token: signToken(openid), profile, recordCount: count });
    return;
  }

  // 以下接口都要令牌
  const openid = openidOf(req);
  if (!openid) {
    fail(res, 401, 'unauthorized', '登录已失效，请重新进入小程序');
    return;
  }

  if (path === '/api/sync/push' && req.method === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body.records) ? body.records : [];
    if (list.length > 200) {
      fail(res, 400, 'too_many', '单次最多 200 条');
      return;
    }
    const accepted = [];
    const rejected = [];
    for (const raw of list) {
      const rec = normalizeRecord(raw);
      if (!rec) {
        rejected.push(raw?.clientId || null);
        continue;
      }
      await db.ensureRecord(openid, rec);
      accepted.push(rec.clientId);
    }
    if (body.clientId) {
      await db.touchDevice(openid, String(body.clientId).slice(0, 64));
    }
    send(res, 200, { accepted, rejected, serverTime: Date.now() });
    return;
  }

  if (path === '/api/sync/pull' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const rawLimit = Number(url.searchParams.get('limit') || 200);
    const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 200));
    const rows = await db.pullRecords(openid, since, limit);
    const records = rows.map((r) => ({
      clientId: r.client_id,
      ts: Number(r.ts),
      durationMin: Number(r.duration_min),
      bristol: r.bristol === null ? null : Number(r.bristol),
      mood: r.mood,
      color: r.color,
      deleted: !!r.deleted,
      updatedAt: Number(r.updated_at),
    }));
    send(res, 200, {
      records,
      cursor: records.length ? records[records.length - 1].updatedAt : since,
      hasMore: records.length === limit,
    });
    return;
  }

  fail(res, 404, 'not_found', '接口不存在');
}

/* ---------------------------- 启动 ---------------------------- */

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error('[error]', req.method, req.url, err);
    }
    fail(res, status, status >= 500 ? 'internal' : 'bad_request', err.message || '服务异常');
  });
});

db = await openDb();

if (process.env.NODE_ENV !== 'test') {
  // 默认只监听回环：生产由 nginx 反代，Node 不应该直接暴露在公网
  const HOST = process.env.HOST || '127.0.0.1';
  server.listen(PORT, HOST, () => {
    console.log(`[laleme-server] listening on ${HOST}:${PORT}, driver=${db.driver}`);
  });
}

export { server, db };
