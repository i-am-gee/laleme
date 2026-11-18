// 拉了么服务端 M1：账号 + 记录同步
// 运行在微信云托管：用户身份由平台注入的 X-WX-OPENID 头提供，不要自己解析登录态。

import http from 'node:http';
import { openDb } from './db.js';
import { exchangeCode, openidFromRequest, signToken } from './auth.js';
import crypto from 'node:crypto';
import * as friends from './friends.js';
import * as pusher from './push.js';
import { startOfToday, summarize, todayKey } from './stats.js';

const PORT = Number(process.env.PORT || 80);
const ALLOW_DEBUG_AUTH = process.env.ALLOW_DEBUG_AUTH === '1';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MAX_BODY = 1024 * 1024; // 1MB，一次最多 200 条记录足够

const MOODS = new Set(['good', 'normal', 'hard']);
const COLORS = new Set(['brown', 'dark', 'tan', 'green', 'black', 'red']);

let db;

// 极简限流：单实例内存计数，够用且不引入依赖。
// 多实例部署时需换成 Redis，否则各实例各算各的。
const RATE_WINDOW = 60 * 1000;
const RATE_LIMIT = 120;
const rateMap = new Map();

function rateLimited(key) {
  const now = Date.now();
  const rec = rateMap.get(key);
  if (!rec || now - rec.start > RATE_WINDOW) {
    rateMap.set(key, { start: now, n: 1 });
    return false;
  }
  rec.n += 1;
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) {
      if (now - v.start > RATE_WINDOW) {
        rateMap.delete(k);
      }
    }
  }
  return rec.n > RATE_LIMIT;
}

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
  // 定时任务入口：每天 20:00 由 systemd timer 触发，用独立密钥鉴权
  if (path === '/api/cron/daily' && req.method === 'POST') {
    const secret = req.headers['x-cron-secret'] || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) {
      fail(res, 403, 'forbidden', '无权调用');
      return;
    }
    const stat = await runDailyReminder();
    send(res, 200, stat);
    return;
  }

  // 模板 ID 不是机密，且订阅弹窗必须在点击栈里同步发起，
  // 客户端要在点击前就拿到 ID —— 所以这个接口不要求登录。
  if (path === '/api/push/templates' && req.method === 'GET') {
    send(res, 200, { daily: pusher.TPL.daily, friend: pusher.TPL.friend });
    return;
  }

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

  if (rateLimited(openid)) {
    fail(res, 429, 'too_many_requests', '操作太频繁，请稍后再试');
    return;
  }

  // 注销：删除该用户的全部云端数据（隐私指引里承诺过的能力）
  if (path === '/api/account' && req.method === 'DELETE') {
    await db.purgeUser(openid);
    console.log('[account:purge]', openid);
    send(res, 200, { ok: true });
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

    // 好友提醒是副作用：不阻塞响应，失败也不影响同步结果
    const todayStart = Date.now() - 24 * 3600 * 1000;
    const hasToday = list.some((r) => r && !r.deleted && Number(r.ts) >= todayStart);
    if (hasToday && accepted.length) {
      friends.notifyFriendsOnRecord(db, pusher, openid).catch((err) => {
        console.error('[notify]', err.message);
      });
    }
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

  /* ---------------- 好友 ---------------- */

  if (path === '/api/friends' && req.method === 'GET') {
    const data = await friends.listWithMe(db, openid);
    const settings = await friends.getSettings(db, openid);
    const quota = {
      daily: await db.quotaOf(openid, pusher.TPL.daily),
      friend: await db.quotaOf(openid, pusher.TPL.friend),
    };
    send(res, 200, { ...data, settings, quota });
    return;
  }

  if (path === '/api/friends/invite' && req.method === 'POST') {
    const token = crypto.randomBytes(12).toString('hex');
    const expireAt = Date.now() + 48 * 3600 * 1000;
    await db.createInvite(openid, token, expireAt);
    send(res, 200, { token, expireAt });
    return;
  }

  if (path === '/api/friends/accept' && req.method === 'POST') {
    const body = await readBody(req);
    const token = String(body.token || '').trim();
    if (!token) {
      fail(res, 400, 'missing_token', '缺少邀请码');
      return;
    }
    const invite = await db.takeInvite(token);
    if (!invite) {
      fail(res, 410, 'invite_invalid', '邀请已失效，请让对方重新分享');
      return;
    }
    if (invite.from_id === openid) {
      fail(res, 400, 'self_invite', '不能添加自己');
      return;
    }
    await db.addFriend(openid, invite.from_id);
    send(res, 200, { ok: true, friendId: invite.from_id });
    return;
  }

  if (path === '/api/friends/remove' && req.method === 'POST') {
    const body = await readBody(req);
    const target = String(body.friendId || '').trim();
    if (!target) {
      fail(res, 400, 'missing_target', '缺少好友标识');
      return;
    }
    await db.removeFriend(openid, target);
    send(res, 200, { ok: true });
    return;
  }

  if (path === '/api/friends/rank' && req.method === 'GET') {
    send(res, 200, await friends.ranking(db, openid));
    return;
  }

  /* ---------------- 订阅与设置 ---------------- */

  if (path === '/api/push/quota' && req.method === 'POST') {
    const body = await readBody(req);
    const kind = body.kind === 'friend' ? 'friend' : 'daily';
    const templateId = kind === 'friend' ? pusher.TPL.friend : pusher.TPL.daily;
    if (!templateId) {
      fail(res, 503, 'template_missing', '服务端尚未配置订阅消息模板');
      return;
    }
    const n = Math.max(0, Math.min(20, Number(body.count || 1)));
    if (n > 0) {
      await db.addQuota(openid, templateId, n);
    }
    send(res, 200, { kind, quota: await db.quotaOf(openid, templateId) });
    return;
  }

  if (path === '/api/push/status' && req.method === 'GET') {
    send(res, 200, {
      settings: await friends.getSettings(db, openid),
      quota: {
        daily: await db.quotaOf(openid, pusher.TPL.daily),
        friend: await db.quotaOf(openid, pusher.TPL.friend),
      },
      templatesConfigured: !!(pusher.TPL.daily || pusher.TPL.friend),
      // 模板 ID 不是机密，客户端要用它拉起订阅弹窗
      templates: { daily: pusher.TPL.daily, friend: pusher.TPL.friend },
    });
    return;
  }

  if (path === '/api/push/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const patch = {};
    if (typeof body.dailyRemind === 'boolean') patch.dailyRemind = body.dailyRemind;
    if (typeof body.friendNotify === 'boolean') patch.friendNotify = body.friendNotify;
    send(res, 200, { settings: await friends.saveSettings(db, openid, patch) });
    return;
  }

  fail(res, 404, 'not_found', '接口不存在');
}

// 每日提醒：当天没有记录 + 有额度 + 未关闭开关 → 发一条
async function runDailyReminder() {
  const today = todayKey();
  const todayStart = startOfToday();
  const users = await db.all('SELECT openid, settings FROM users', []);
  let sent = 0;
  let skippedQuota = 0;
  let skippedDone = 0;

  for (const u of users) {
    const s = await friends.getSettings(db, u.openid);
    if (!s.dailyRemind) {
      continue;
    }
    const rows = await db.all(
      'SELECT ts FROM records WHERE openid = ? AND deleted = 0 AND ts >= ? LIMIT 1',
      [u.openid, todayStart]
    );
    if (rows.length) {
      skippedDone += 1;
      continue;
    }
    const quota = await db.quotaOf(u.openid, pusher.TPL.daily);
    if (quota <= 0) {
      skippedQuota += 1;
      continue;
    }
    const claimed = await db.markPushed(u.openid, 'daily', today);
    if (!claimed) {
      continue;
    }
    // 连续天数：今天没记，从昨天往前数
    const hist = await db.all(
      'SELECT ts FROM records WHERE openid = ? AND deleted = 0 AND ts >= ?',
      [u.openid, Date.now() - 120 * 24 * 3600 * 1000]
    );
    const streak = summarize(hist).streak;
    const res = await pusher.sendSubscribe({
      openid: u.openid,
      templateId: pusher.TPL.daily,
      data: pusher.dailyData({ streak }),
    });
    if (res.ok) {
      await db.consumeQuota(u.openid, pusher.TPL.daily);
      sent += 1;
    } else {
      // 发不出去（未授权 / 额度问题）就把占位撤掉，别占着今天的名额
      await db.clearPushed(u.openid, 'daily', today);
    }
  }
  console.log('[cron:daily]', { users: users.length, sent, skippedQuota, skippedDone });
  return { users: users.length, sent, skippedQuota, skippedDone };
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
