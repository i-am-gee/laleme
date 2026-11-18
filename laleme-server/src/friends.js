// 好友与排名：只对外暴露聚合值，任何单条记录明细都不出现在这里。

import { rankList, summarize, todayKey } from './stats.js';

const WINDOW_DAYS = 30;
const DAY = 24 * 3600 * 1000;

function displayNick(user, openid) {
  if (user && user.nick) {
    return user.nick;
  }
  // 没有昵称时给一个稳定的占位名，不要暴露 openid
  return '拉友' + openid.slice(-4);
}

async function profilesOf(db, ids) {
  const users = await db.usersByIds(ids);
  const byId = new Map(users.map((u) => [u.openid, u]));
  const rows = await db.recordsSince(ids, Date.now() - WINDOW_DAYS * DAY);
  const grouped = new Map(ids.map((id) => [id, []]));
  rows.forEach((r) => {
    if (grouped.has(r.openid)) {
      grouped.get(r.openid).push(r);
    }
  });
  return ids.map((id) => {
    const s = summarize(grouped.get(id) || []);
    return {
      id,
      nick: displayNick(byId.get(id), id),
      avatar: byId.get(id)?.avatar || '',
      todayDone: s.todayDone,
      streak: s.streak,
      tierName: s.tier.name,
      tierLevel: s.tier.level,
      weekDays: s.weekDays,
      avgMin: s.avgMin,
      lastActiveAt: Number(byId.get(id)?.updated_at || 0),
    };
  });
}

// 我的资料 + 好友列表（含自己，便于页面直接渲染"我"那一行）
export async function listWithMe(db, openid) {
  const ids = [openid, ...(await db.friendIds(openid))];
  const list = await profilesOf(db, ids);
  const me = list.find((u) => u.id === openid);
  const friends = list.filter((u) => u.id !== openid);
  return { me, friends };
}

export async function ranking(db, openid) {
  const ids = [openid, ...(await db.friendIds(openid))];
  const list = await profilesOf(db, ids);
  const ranked = rankList(list).map((u) => ({
    id: u.id,
    nick: u.nick,
    avatar: u.avatar,
    rank: u.rank,
    weekDays: u.weekDays,
    streak: u.streak,
    tierName: u.tierName,
    avgMin: u.avgMin,
    isMe: u.id === openid,
  }));
  return { list: ranked, myRank: ranked.find((u) => u.isMe)?.rank || 0 };
}

// 好友打卡后通知其余好友：每个接收者每天最多一条，触发者每天只触发一次
export async function notifyFriendsOnRecord(db, pusher, openid) {
  const settings = await getSettings(db, openid);
  if (!settings.friendNotify) {
    return { skipped: 'off' };
  }
  const ids = await db.friendIds(openid);
  if (!ids.length) {
    return { skipped: 'no_friends' };
  }
  // 触发者当天只触发一次
  const day = todayKey();
  const fired = await db.markPushed(openid, 'friend_trigger', day);
  if (!fired) {
    return { skipped: 'already_triggered' };
  }

  const profiles = await profilesOf(db, [openid]);
  const me = profiles[0];
  let sent = 0;
  for (const fid of ids) {
    const fs = await getSettings(db, fid);
    if (!fs.friendNotify) {
      continue;
    }
    const quota = await db.quotaOf(fid, pusher.TPL.friend);
    if (quota <= 0) {
      continue;
    }
    const okToSend = await db.markPushed(fid, 'friend', day);
    if (!okToSend) {
      continue;
    }
    const res = await pusher.sendSubscribe({
      openid: fid,
      templateId: pusher.TPL.friend,
      data: pusher.friendData({ nick: me.nick, streak: me.streak }),
    });
    if (res.ok) {
      await db.consumeQuota(fid, pusher.TPL.friend);
      sent += 1;
    }
  }
  return { sent };
}

export async function getSettings(db, openid) {
  const user = await db.one('SELECT settings FROM users WHERE openid = ?', [openid]);
  let s = {};
  try {
    s = typeof user?.settings === 'string' ? JSON.parse(user.settings) : user?.settings || {};
  } catch {
    s = {};
  }
  return {
    dailyRemind: s.dailyRemind !== false,
    friendNotify: s.friendNotify !== false,
  };
}

export async function saveSettings(db, openid, patch) {
  const cur = await getSettings(db, openid);
  const next = { ...cur, ...patch };
  await db.upsertUser(openid, { settings: next });
  return next;
}
