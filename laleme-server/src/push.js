// 微信接口：access_token 与订阅消息下发。
// 注意：订阅消息是「一次性」的——用户授权一次，只能发一条，额度按 (openid, 模板) 计。

const APPID = process.env.WX_APPID || '';
const SECRET = process.env.WX_SECRET || '';
const DRY_RUN = process.env.PUSH_DRY_RUN === '1';

export const TPL = {
  daily: process.env.TPL_DAILY || '',
  friend: process.env.TPL_FRIEND || '',
};

let cache = { token: '', exp: 0 };

export async function accessToken() {
  if (cache.token && cache.exp - Date.now() > 5 * 60 * 1000) {
    return cache.token;
  }
  if (!APPID || !SECRET) {
    throw new Error('未配置 WX_APPID / WX_SECRET');
  }
  // stable_token 不会顶掉其它正在使用的 token，比默认接口安全
  const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: APPID, secret: SECRET }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`获取 access_token 失败：${data.errcode} ${data.errmsg}`);
  }
  cache = {
    token: data.access_token,
    exp: Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000,
  };
  return cache.token;
}

/**
 * 下发一条订阅消息。
 * @param {object} p
 * @param {string} p.openid
 * @param {string} p.templateId
 * @param {object} p.data  与模板字段一一对应，如 { thing1: { value: '今天还没有记录' } }
 * @param {string} [p.page]
 * @returns {Promise<{ok:boolean, errcode?:number, dryRun?:boolean}>}
 */
export async function sendSubscribe({ openid, templateId, data, page = 'pages/index/index' }) {
  if (!templateId) {
    return { ok: false, reason: 'no_template' };
  }
  if (DRY_RUN || !APPID || !SECRET) {
    console.log('[push:dry-run]', openid, templateId, JSON.stringify(data));
    return { ok: true, dryRun: true };
  }
  const token = await accessToken();
  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      touser: openid,
      template_id: templateId,
      page,
      miniprogram_state: process.env.MP_STATE || 'formal',
      lang: 'zh_CN',
      data,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const out = await res.json();
  if (out.errcode === 0) {
    return { ok: true };
  }
  // 43101：用户未订阅或额度用尽——这是预期内的，不算故障
  console.log('[push:fail]', openid, out.errcode, out.errmsg);
  return { ok: false, errcode: out.errcode, errmsg: out.errmsg };
}

/* ------------------------- 模板数据结构 ------------------------- */
/* ⚠️ 字段名必须与后台所选模板的关键词一一对应。
   换模板时只改这两个函数，其余逻辑不动。 */

export function dailyData({ days, streak }) {
  return {
    thing1: { value: streak > 0 ? `已连续 ${streak} 天` : '今天还没有记录' },
    time2: { value: formatNow() },
    thing3: { value: '记一次，只要十秒' },
  };
}

export function friendData({ nick, streak }) {
  return {
    thing1: { value: `${nick || '好友'} 完成了今日打卡` },
    thing2: { value: streak > 0 ? `已连续 ${streak} 天` : '刚刚开始' },
    time3: { value: formatNow() },
  };
}

function formatNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
