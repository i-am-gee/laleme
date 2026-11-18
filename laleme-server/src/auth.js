// 身份与鉴权。
// 这版服务端跑在自己的服务器上（不是云托管），平台不会注入可信的 openid，
// 所以必须走微信登录换 openid，再签发自己的令牌——绝不能直接信任客户端传来的身份头。

import crypto from 'node:crypto';

const APPID = process.env.WX_APPID || '';
const SECRET = process.env.WX_SECRET || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const TOKEN_TTL = 90 * 24 * 3600; // 90 天，够长，避免频繁重新登录

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function hmac(data) {
  return b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest());
}

export function signToken(openid) {
  if (!TOKEN_SECRET) {
    throw new Error('TOKEN_SECRET 未配置');
  }
  const payload = b64url(JSON.stringify({ openid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }));
  return payload + '.' + hmac(payload);
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !TOKEN_SECRET) {
    return null;
  }
  const idx = token.lastIndexOf('.');
  if (idx <= 0) {
    return null;
  }
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expect = hmac(payload);
  // 长度不等时 timingSafeEqual 会抛错，先挡一层
  if (sig.length !== expect.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    return null;
  }
  try {
    const data = JSON.parse(fromB64url(payload));
    if (!data.openid || !data.exp || data.exp * 1000 < Date.now()) {
      return null;
    }
    return data.openid;
  } catch {
    return null;
  }
}

// 用 wx.login 拿到的 code 换 openid
export async function exchangeCode(code) {
  if (!APPID || !SECRET) {
    throw Object.assign(new Error('未配置 WX_APPID / WX_SECRET'), { status: 500 });
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', APPID);
  url.searchParams.set('secret', SECRET);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  if (!data.openid) {
    throw Object.assign(new Error(`微信登录失败：${data.errcode || ''} ${data.errmsg || ''}`.trim()), {
      status: 401,
    });
  }
  return data.openid;
}

// 请求里的身份：优先 Bearer 令牌；本地联调才允许 debug 头
export function openidFromRequest(req, allowDebug) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const openid = verifyToken(auth.slice(7).trim());
    if (openid) {
      return openid;
    }
    return null;
  }
  if (allowDebug) {
    const debug = req.headers['x-debug-openid'];
    if (debug) {
      return String(debug);
    }
  }
  return null;
}
