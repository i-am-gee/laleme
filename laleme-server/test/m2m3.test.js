// M2/M3/M4 服务端测试：好友关系、排名口径、订阅额度、每日提醒、好友通知去重。
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_FILE = ':memory:';
process.env.ALLOW_DEBUG_AUTH = '1';
process.env.NODE_ENV = 'test';
process.env.PORT = '3197';
process.env.TOKEN_SECRET = 'test-secret';
process.env.CRON_SECRET = 'cron-test';
process.env.PUSH_DRY_RUN = '1';
process.env.TPL_DAILY = 'tpl_daily';
process.env.TPL_FRIEND = 'tpl_friend';

const { server } = await import('../src/index.js');
await new Promise((r) => server.listen(3197, r));
const base = 'http://127.0.0.1:3197';

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
    if (cond) { pass += 1; console.log('  ✓', name); }
    else { fail += 1; console.log('  ✗', name, extra ?? ''); }
};

const TZ = 8 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;
const dayStart = (offset) => Math.floor((Date.now() + TZ) / DAY - offset) * DAY - TZ + 3600 * 1000;

async function call(method, path, openid, body) {
    const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-debug-openid': openid },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
}

async function pushRecords(openid, list) {
    return call('POST', '/api/sync/push', openid, { records: list });
}

console.log('好友 / 排名 / 订阅');

// 1. 三个用户建档
for (const [id, nick] of [['u_a', '小A'], ['u_b', '小B'], ['u_c', '小C']]) {
    await call('POST', '/api/login', id, { code: 'debug:' + id, nick });
}

// 2. 造数据：A 连续 3 天、B 只有今天、C 空
await pushRecords('u_a', [0, 1, 2].map((d) => ({
    clientId: 'a' + d, ts: dayStart(d), durationMin: 6, bristol: 4, mood: 'good', color: 'brown', updatedAt: Date.now() - d * 1000,
})));
await pushRecords('u_b', [{
    clientId: 'b0', ts: dayStart(0), durationMin: 20, bristol: 4, mood: 'normal', color: 'tan', updatedAt: Date.now(),
}]);

// 3. 空好友列表时只有自己
const empty = await call('GET', '/api/friends', 'u_a');
check('无好友时 friends 为空', empty.data.friends.length === 0);
check('自己数据正确（连续 3 天）', empty.data.me.streak === 3, empty.data.me);
check('段位按 3 天判为青铜', empty.data.me.tierName === '倔强青铜', empty.data.me.tierName);

// 4. 邀请 + 接受
const inv = await call('POST', '/api/friends/invite', 'u_a');
check('生成邀请码', typeof inv.data.token === 'string' && inv.data.token.length === 24);
const acc = await call('POST', '/api/friends/accept', 'u_b', { token: inv.data.token });
check('B 接受邀请成功', acc.data.ok === true);
const again = await call('POST', '/api/friends/accept', 'u_c', { token: inv.data.token });
check('同一邀请码不能用第二次', again.status === 410);
const self = await call('POST', '/api/friends/invite', 'u_a');
const selfAcc = await call('POST', '/api/friends/accept', 'u_a', { token: self.data.token });
check('不能添加自己', selfAcc.status === 400);

// 5. 好友可见范围
const listA = await call('GET', '/api/friends', 'u_a');
check('A 看到 1 个好友', listA.data.friends.length === 1);
const f = listA.data.friends[0];
check('好友只给聚合字段', f.weekDays >= 0 && f.streak >= 0 && f.avgMin > 0 && f.detail === undefined);
check('不泄露好友明细字段', !('records' in f) && !('ts' in f));

// 6. 排名：A 活跃 3 天 > B 活跃 1 天
const rankA = await call('GET', '/api/friends/rank', 'u_a');
check('排名把自己算进去', rankA.data.list.length === 2);
check('A 排第一', rankA.data.list[0].isMe === true && rankA.data.myRank === 1, rankA.data.list);

// 7. 订阅额度
const q0 = await call('GET', '/api/push/status', 'u_b');
check('初始额度为 0', q0.data.quota.daily === 0);
await call('POST', '/api/push/quota', 'u_b', { kind: 'daily', count: 2 });
const q1 = await call('GET', '/api/push/status', 'u_b');
check('上报后额度为 2', q1.data.quota.daily === 2);

// 8. 每日提醒：A 今天有记录（跳过），B 有记录（跳过），C 没记录但无额度
const cron1 = await fetch(base + '/api/cron/daily', { method: 'POST', headers: { 'x-cron-secret': 'cron-test' } }).then((r) => r.json());
check('今日已记录的用户被跳过', cron1.skippedDone >= 2, cron1);
check('无额度用户不发', cron1.sent === 0, cron1);

// 9. 给 C 额度后再跑：应发 1 条
await call('POST', '/api/push/quota', 'u_c', { kind: 'daily', count: 1 });
const cron2 = await fetch(base + '/api/cron/daily', { method: 'POST', headers: { 'x-cron-secret': 'cron-test' } }).then((r) => r.json());
check('C 收到提醒', cron2.sent === 1, cron2);
const qC = await call('GET', '/api/push/status', 'u_c');
check('发送后扣掉额度', qC.data.quota.daily === 0, qC.data.quota);

// 10. 同一天重复跑，不重复发
await call('POST', '/api/push/quota', 'u_c', { kind: 'daily', count: 1 });
const cron3 = await fetch(base + '/api/cron/daily', { method: 'POST', headers: { 'x-cron-secret': 'cron-test' } }).then((r) => r.json());
check('同一天不重复提醒', cron3.sent === 0, cron3);

// 11. 好友通知：B 打卡 → A 收到（A 有 friend 额度）
await call('POST', '/api/push/quota', 'u_a', { kind: 'friend', count: 2 });
await pushRecords('u_b', [{
    clientId: 'b_new', ts: Date.now(), durationMin: 5, bristol: 4, mood: 'good', color: 'brown', updatedAt: Date.now() + 10,
}]);
await new Promise((r) => setTimeout(r, 300));
const afterFriend = await call('GET', '/api/push/status', 'u_a');
check('好友打卡后 A 的额度被消耗', afterFriend.data.quota.friend === 1, afterFriend.data.quota);

// 12. 再打卡一次，不再重复通知
await pushRecords('u_b', [{
    clientId: 'b_new2', ts: Date.now(), durationMin: 5, bristol: 4, mood: 'good', color: 'brown', updatedAt: Date.now() + 20,
}]);
await new Promise((r) => setTimeout(r, 300));
const afterFriend2 = await call('GET', '/api/push/status', 'u_a');
check('同一好友当天只通知一次', afterFriend2.data.quota.friend === 1, afterFriend2.data.quota);

// 13. 关闭开关后不再通知
await call('POST', '/api/push/settings', 'u_a', { friendNotify: false });
await call('POST', '/api/push/quota', 'u_a', { kind: 'friend', count: 1 });
const before = (await call('GET', '/api/push/status', 'u_a')).data.quota.friend;
await pushRecords('u_c', [{ clientId: 'c1', ts: Date.now(), durationMin: 5, bristol: 4, mood: 'good', color: 'brown', updatedAt: Date.now() }]);
await new Promise((r) => setTimeout(r, 300));
const after = (await call('GET', '/api/push/status', 'u_a')).data.quota.friend;
check('关闭好友提醒后不消耗额度', before === after, { before, after });

// 14. 解除好友后互相看不到
await call('POST', '/api/friends/remove', 'u_a', { friendId: 'u_b' });
const afterRemove = await call('GET', '/api/friends', 'u_a');
check('解除后好友列表为空', afterRemove.data.friends.length === 0);

server.close();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
