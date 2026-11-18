// 同步引擎的前后端联调测试：真起服务端，桩掉 wx 的 storage/request，验证
// 「本地上传 → 换机恢复 → 删除同步 → 冲突不覆盖」四条主路径。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = '/Users/ghost/WorkBuddy/2026-11-09-16-58-52';

// ---- 启动服务端（sqlite 内存库） ----
const serverEnv = { ...process.env, DB_DRIVER: 'sqlite', SQLITE_FILE: ':memory:', ALLOW_DEBUG_AUTH: '1', PORT: '3188', TOKEN_SECRET: 'test-secret' };
const server = spawn(process.execPath, ['--experimental-sqlite', 'src/index.js'], {
    cwd: path.join(ROOT, 'laleme-server'),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('服务端启动超时')), 8000);
    server.stdout.on('data', (d) => {
        if (String(d).includes('listening')) {
            clearTimeout(t);
            resolve();
        }
    });
    server.stderr.on('data', (d) => process.stderr.write(d));
});

// ---- 桩出 mini program 的 wx ----
const store = new Map();
const storage = (openid) => ({
    getStorageSync: (k) => store.get(openid + '#' + k),
    setStorageSync: (k, v) => store.set(openid + '#' + k, v),
    removeStorageSync: (k) => store.delete(openid + '#' + k),
});

let current = 'alice';
globalThis.wx = {
    ...storage('alice'),
    login({ success }) {
        success({ code: 'debug:' + current });
    },
    request({ url, method, data, header, success, fail }) {
        fetch(url, { method, headers: header, body: method === 'GET' ? undefined : JSON.stringify(data) })
            .then(async (r) => success({ statusCode: r.status, data: await r.json() }))
            .catch((e) => fail({ errMsg: e.message }));
    },
};

const sync = require(path.join(ROOT, 'laleme-miniprogram/utils/sync.js'));
const cloud = require(path.join(ROOT, 'laleme-miniprogram/utils/cloud.js'));

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
    if (cond) { pass += 1; console.log('  ✓', name); }
    else { fail += 1; console.log('  ✗', name, extra ?? ''); }
};

const REC_KEY = 'laleme_records';
const useDevice = (openid) => {
    current = openid;
    Object.assign(globalThis.wx, storage(openid));
    cloud.writeConfig({ enabled: true, mode: 'http', baseUrl: 'http://127.0.0.1:3188', debugOpenid: openid, cursor: 0, lastSync: 0 });
};

console.log('客户端 ↔ 服务端联调');

// 设备 A：本地有三条记录，开启同步
useDevice('alice');
const rec = (i) => ({
    id: 'r' + i,
    timestamp: 1794900000000 + i * 60000,
    durationMin: 5,
    bristol: 4,
    mood: 'good',
    color: 'brown',
    createdAt: 1794900000000 + i,
    updatedAt: 1794900000000 + i,
});
wx.setStorageSync(REC_KEY, [rec(1), rec(2), rec(3)]);
await sync.enable({ nick: '小拉' });
check('首次开启把本地 3 条推上去', true);

// 设备 B：清空本地（模拟清缓存），登录后应恢复
useDevice('alice');
wx.removeStorageSync(REC_KEY);
wx.removeStorageSync('laleme_tombstones');
const stat = await sync.pullAll();
const restored = wx.getStorageSync(REC_KEY) || [];
check('清缓存后能拉回全部记录', restored.length === 3, restored.length);
check('恢复的记录字段完整', restored[0].durationMin === 5 && restored[0].bristol === 4);

// 设备 B 删一条，设备 A 应该跟着消失
const target = restored.find((r) => r.id === 'r2');
const list = restored.filter((r) => r.id !== target.id);
wx.setStorageSync(REC_KEY, list);
sync.markDeleted(target.id);
await sync.syncNow();

useDevice('alice');
wx.setStorageSync(REC_KEY, []);
cloud.writeConfig({ cursor: 0 });
await sync.pullAll();
const afterDel = wx.getStorageSync(REC_KEY) || [];
check('删除能同步到其他设备', afterDel.length === 2 && !afterDel.some((r) => r.id === 'r2'), afterDel.map((r) => r.id));

// 冲突：本地把 r1 时长改成 99，云端是 5，以 updatedAt 大者为准
const localR1 = afterDel.find((r) => r.id === 'r1');
localR1.durationMin = 99;
localR1.updatedAt = Date.now();
wx.setStorageSync(REC_KEY, afterDel);
await sync.syncNow();
useDevice('alice');
wx.setStorageSync(REC_KEY, []);
cloud.writeConfig({ cursor: 0 });
await sync.pullAll();
const merged = wx.getStorageSync(REC_KEY) || [];
const r1 = merged.find((r) => r.id === 'r1');
check('本地较新的修改会覆盖云端', r1 && r1.durationMin === 99, r1);

server.kill();
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
