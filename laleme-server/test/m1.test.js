// M1 冒烟测试：不依赖任何外部服务，用内存 SQLite 跑通「写→读→换机恢复→幂等→软删」。
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_FILE = ':memory:';
process.env.ALLOW_DEBUG_AUTH = '1';
process.env.NODE_ENV = 'test';
process.env.PORT = '3199';
process.env.TOKEN_SECRET = 'test-secret-not-for-prod';

const { server } = await import('../src/index.js');

await new Promise((r) => server.listen(3199, r));
const base = 'http://127.0.0.1:3199';

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}`, extra ?? '');
  }
}

const H = (openid) => ({ 'content-type': 'application/json', 'x-debug-openid': openid });

async function j(method, path, body, openid = 'u_alice') {
  const res = await fetch(base + path, {
    method,
    headers: H(openid),
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

console.log('M1 同步链路');

// 1. 健康检查
const health = await fetch(base + '/api/health').then((r) => r.json());
check('健康检查可用', health.ok === true && health.driver === 'sqlite');

// 2. 无身份被拒
const noCode = await fetch(base + '/api/login', { method: 'POST' });
check('登录缺少 code 返回 400', noCode.status === 400);
const noToken = await fetch(base + '/api/sync/pull?since=0', { method: 'GET' });
check('受保护接口无令牌返回 401', noToken.status === 401);
const badToken = await fetch(base + '/api/sync/pull?since=0', {
    method: 'GET',
    headers: { authorization: 'Bearer forged.token' },
});
check('伪造令牌被拒', badToken.status === 401);

// 3. 登录建档
const login = await j('POST', '/api/login', { code: 'debug:u_alice', nick: '小拉' });
check('登录返回昵称', login.data.profile.nick === '小拉');
check('初始记录数为 0', login.data.recordCount === 0);

// 4. 推送三条
const rec = (i, extra = {}) => ({
  clientId: `c${i}`,
  ts: 1794900000000 + i * 1000,
  durationMin: 5,
  bristol: 4,
  mood: 'good',
  color: 'brown',
  updatedAt: 1794900000000 + i,
  ...extra,
});
const push1 = await j('POST', '/api/sync/push', { clientId: 'dev1', records: [rec(1), rec(2), rec(3)] });
check('推送 3 条全部接受', push1.data.accepted.length === 3);

// 5. 幂等：同 clientId 再推一次，条数不变
await j('POST', '/api/sync/push', { clientId: 'dev1', records: [rec(1), rec(2), rec(3)] });
const count1 = await j('POST', '/api/login', { code: 'debug:u_alice' });
check('重复推送不产生副本', count1.data.recordCount === 3);

// 6. 非法数据被拒
const bad = await j('POST', '/api/sync/push', {
  records: [
    { clientId: 'bad1', ts: 1, durationMin: 0 },
    { clientId: 'bad2', ts: 1, durationMin: 5, bristol: 9 },
    { clientId: 'bad3', ts: 1, durationMin: 5, mood: 'xx' },
    rec(4),
  ],
});
check('非法记录进入 rejected', bad.data.rejected.length === 3 && bad.data.accepted.length === 1);

// 7. 换机恢复：新设备拉全量
const pull = await j('GET', '/api/sync/pull?since=0&limit=200');
check('拉全量能取回 4 条', pull.data.records.length === 4);
check('游标为最后一条的 updatedAt', pull.data.cursor === pull.data.records.at(-1).updatedAt);

// 8. 增量：用游标再拉，应为 0 条
const pull2 = await j('GET', `/api/sync/pull?since=${pull.data.cursor}`);
check('游标之后无新增', pull2.data.records.length === 0);

// 9. 软删：删除后能同步到其他设备
await j('POST', '/api/sync/push', { records: [rec(2, { deleted: true, updatedAt: 1794900009999 })] });
const pull3 = await j('GET', `/api/sync/pull?since=${pull.data.cursor}`);
check('软删可同步', pull3.data.records.length === 1 && pull3.data.records[0].deleted === true);
const count2 = await j('POST', '/api/login', { code: 'debug:u_alice' });
check('软删后计数为 3', count2.data.recordCount === 3);

// 10. 用户隔离
const other = await j('GET', '/api/sync/pull?since=0', undefined, 'u_bob');
check('不同用户数据隔离', other.data.records.length === 0);

// 11. 冲突：旧 updatedAt 不覆盖新值
await j('POST', '/api/sync/push', { records: [rec(1, { durationMin: 99, updatedAt: 1 })] });
const pull4 = await j('GET', '/api/sync/pull?since=0');
const one = pull4.data.records.find((r) => r.clientId === 'c1');
check('旧数据不覆盖新数据', one.durationMin === 5, one);

server.close();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
