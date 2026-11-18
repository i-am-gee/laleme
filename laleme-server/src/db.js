// 数据层：一套接口，两种驱动。
// 生产走 MySQL（云托管挂载的腾讯云数据库），本地与测试走 node:sqlite（零依赖）。
// SQL 里有少量方言差异（upsert 语法），集中在 ensureRecord() 里分支，其余语句保持可移植。

import { randomUUID } from 'node:crypto';

const DRIVER = process.env.DB_DRIVER || 'mysql';

/* ------------------------------------------------------------------ */
/* 建表                                                                */
/* ------------------------------------------------------------------ */

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  openid      TEXT PRIMARY KEY,
  nick        TEXT,
  avatar      TEXT,
  settings    TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id           TEXT PRIMARY KEY,
  openid       TEXT NOT NULL,
  client_id    TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  bristol      INTEGER,
  mood         TEXT,
  color        TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  UNIQUE (openid, client_id)
);
CREATE INDEX IF NOT EXISTS idx_records_pull ON records (openid, updated_at);
CREATE TABLE IF NOT EXISTS friends (
  a          TEXT NOT NULL,
  b          TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS invites (
  token      TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL,
  expire_at  INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS push_quota (
  openid      TEXT NOT NULL,
  template_id TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (openid, template_id)
);
CREATE TABLE IF NOT EXISTS push_logs (
  openid   TEXT NOT NULL,
  type     TEXT NOT NULL,
  day      TEXT NOT NULL,
  sent_at  INTEGER NOT NULL,
  PRIMARY KEY (openid, type, day)
);
CREATE TABLE IF NOT EXISTS devices (
  openid     TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  last_sync  INTEGER NOT NULL,
  PRIMARY KEY (openid, client_id)
);
`;

const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    openid      VARCHAR(64) PRIMARY KEY,
    nick        VARCHAR(64) NULL,
    avatar      VARCHAR(512) NULL,
    settings    JSON NOT NULL,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS records (
    id           CHAR(36) PRIMARY KEY,
    openid       VARCHAR(64) NOT NULL,
    client_id    VARCHAR(64) NOT NULL,
    ts           BIGINT NOT NULL,
    duration_min INT NOT NULL,
    bristol      TINYINT NULL,
    mood         VARCHAR(16) NULL,
    color        VARCHAR(16) NULL,
    deleted      TINYINT NOT NULL DEFAULT 0,
    updated_at   BIGINT NOT NULL,
    UNIQUE KEY uk_openid_client (openid, client_id),
    KEY idx_records_pull (openid, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS friends (
    a VARCHAR(64) NOT NULL,
    b VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    PRIMARY KEY (a, b),
    KEY idx_friends_b (b)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS invites (
    token VARCHAR(64) PRIMARY KEY,
    from_id VARCHAR(64) NOT NULL,
    expire_at BIGINT NOT NULL,
    used TINYINT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS push_quota (
    openid VARCHAR(64) NOT NULL,
    template_id VARCHAR(64) NOT NULL,
    count INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (openid, template_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS push_logs (
    openid VARCHAR(64) NOT NULL,
    type VARCHAR(24) NOT NULL,
    day VARCHAR(10) NOT NULL,
    sent_at BIGINT NOT NULL,
    PRIMARY KEY (openid, type, day)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS devices (
    openid    VARCHAR(64) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    last_sync BIGINT NOT NULL,
    PRIMARY KEY (openid, client_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

/* ------------------------------------------------------------------ */
/* SQLite 驱动（本地/测试）                                             */
/* ------------------------------------------------------------------ */

async function createSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const file = process.env.SQLITE_FILE || ':memory:';
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SQLITE_SCHEMA);

  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

  return {
    driver: 'sqlite',
    async all(sql, params = []) {
      return db.prepare(norm(sql)).all(...params);
    },
    async one(sql, params = []) {
      return db.prepare(norm(sql)).get(...params) || null;
    },
    async run(sql, params = []) {
      return db.prepare(norm(sql)).run(...params);
    },
    async close() {
      db.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* MySQL 驱动（生产）                                                   */
/* ------------------------------------------------------------------ */

async function createMysql() {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'laleme',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL || 5),
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  for (const stmt of MYSQL_SCHEMA) {
    await pool.query(stmt);
  }

  return {
    driver: 'mysql',
    async all(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows;
    },
    async one(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows[0] || null;
    },
    async run(sql, params = []) {
      const [res] = await pool.execute(sql, params);
      return res;
    },
    async close() {
      await pool.end();
    },
  };
}

/* ------------------------------------------------------------------ */
/* 对外：仓储方法                                                       */
/* ------------------------------------------------------------------ */

export async function openDb() {
  const base = DRIVER === 'sqlite' ? await createSqlite() : await createMysql();

  base.upsertUser = async function upsertUser(openid, patch = {}) {
    const now = Date.now();
    const existing = await base.one('SELECT * FROM users WHERE openid = ?', [openid]);
    if (!existing) {
      await base.run(
        'INSERT INTO users (openid, nick, avatar, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [openid, patch.nick || null, patch.avatar || null, JSON.stringify(patch.settings || {}), now, now]
      );
      return { openid, nick: patch.nick || null, avatar: patch.avatar || null, settings: patch.settings || {}, createdAt: now };
    }
    const nick = patch.nick === undefined ? existing.nick : patch.nick;
    const avatar = patch.avatar === undefined ? existing.avatar : patch.avatar;
    const settings = patch.settings === undefined ? existing.settings : JSON.stringify(patch.settings);
    await base.run('UPDATE users SET nick = ?, avatar = ?, settings = ?, updated_at = ? WHERE openid = ?', [
      nick, avatar, settings, now, openid,
    ]);
    return {
      openid,
      nick,
      avatar,
      settings: typeof settings === 'string' ? JSON.parse(settings) : settings,
      createdAt: existing.created_at,
    };
  };

  // 幂等写入：同一 (openid, clientId) 只保留一条，updatedAt 大者胜
  base.ensureRecord = async function ensureRecord(openid, rec) {
    const id = randomUUID();
    const params = [
      id, openid, rec.clientId, rec.ts, rec.durationMin,
      rec.bristol, rec.mood, rec.color, rec.deleted ? 1 : 0, rec.updatedAt,
    ];
    if (base.driver === 'mysql') {
      await base.run(
        `INSERT INTO records (id, openid, client_id, ts, duration_min, bristol, mood, color, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           ts = IF(VALUES(updated_at) >= updated_at, VALUES(ts), ts),
           duration_min = IF(VALUES(updated_at) >= updated_at, VALUES(duration_min), duration_min),
           bristol = IF(VALUES(updated_at) >= updated_at, VALUES(bristol), bristol),
           mood = IF(VALUES(updated_at) >= updated_at, VALUES(mood), mood),
           color = IF(VALUES(updated_at) >= updated_at, VALUES(color), color),
           deleted = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted),
           updated_at = GREATEST(updated_at, VALUES(updated_at))`,
        params
      );
    } else {
      await base.run(
        `INSERT INTO records (id, openid, client_id, ts, duration_min, bristol, mood, color, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (openid, client_id) DO UPDATE SET
           ts = CASE WHEN excluded.updated_at >= records.updated_at THEN excluded.ts ELSE records.ts END,
           duration_min = CASE WHEN excluded.updated_at >= records.updated_at THEN excluded.duration_min ELSE records.duration_min END,
           bristol = CASE WHEN excluded.updated_at >= records.updated_at THEN excluded.bristol ELSE records.bristol END,
           mood = CASE WHEN excluded.updated_at >= records.updated_at THEN excluded.mood ELSE records.mood END,
           color = CASE WHEN excluded.updated_at >= records.updated_at THEN excluded.color ELSE records.color END,
           deleted = CASE WHEN excluded.updated_at >= records.updated_at THEN excluded.deleted ELSE records.deleted END,
           updated_at = MAX(records.updated_at, excluded.updated_at)`,
        params
      );
    }
    return base.one('SELECT * FROM records WHERE openid = ? AND client_id = ?', [openid, rec.clientId]);
  };

  base.pullRecords = async function pullRecords(openid, since, limit) {
    return base.all(
      `SELECT client_id, ts, duration_min, bristol, mood, color, deleted, updated_at
       FROM records WHERE openid = ? AND updated_at > ?
       ORDER BY updated_at ASC LIMIT ?`,
      [openid, since, limit]
    );
  };

  base.countRecords = async function countRecords(openid) {
    const row = await base.one('SELECT COUNT(*) AS n FROM records WHERE openid = ? AND deleted = 0', [openid]);
    return Number(row?.n || 0);
  };

  base.touchDevice = async function touchDevice(openid, clientId) {
    const now = Date.now();
    if (base.driver === 'mysql') {
      await base.run(
        `INSERT INTO devices (openid, client_id, last_sync) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_sync = VALUES(last_sync)`,
        [openid, clientId, now]
      );
    } else {
      await base.run(
        `INSERT INTO devices (openid, client_id, last_sync) VALUES (?, ?, ?)
         ON CONFLICT (openid, client_id) DO UPDATE SET last_sync = excluded.last_sync`,
        [openid, clientId, now]
      );
    }
  };

  /* ---------- 好友 ---------- */

  base.addFriend = async function addFriend(x, y) {
    const [a, b] = x < y ? [x, y] : [y, x];
    const now = Date.now();
    if (base.driver === 'mysql') {
      await base.run(
        'INSERT INTO friends (a, b, status, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
        [a, b, 'active', now]
      );
    } else {
      await base.run(
        'INSERT INTO friends (a, b, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (a, b) DO UPDATE SET status = excluded.status',
        [a, b, 'active', now]
      );
    }
  };

  base.removeFriend = async function removeFriend(x, y) {
    const [a, b] = x < y ? [x, y] : [y, x];
    await base.run('DELETE FROM friends WHERE a = ? AND b = ?', [a, b]);
  };

  base.friendIds = async function friendIds(openid) {
    const rows = await base.all(
      'SELECT a, b FROM friends WHERE status = ? AND (a = ? OR b = ?)',
      ['active', openid, openid]
    );
    return rows.map((r) => (r.a === openid ? r.b : r.a));
  };

  base.usersByIds = async function usersByIds(ids) {
    if (!ids.length) {
      return [];
    }
    const marks = ids.map(() => '?').join(',');
    return base.all(
      `SELECT openid, nick, avatar, updated_at FROM users WHERE openid IN (${marks})`,
      ids
    );
  };

  /* ---------- 邀请 ---------- */

  base.createInvite = async function createInvite(from, token, expireAt) {
    await base.run('INSERT INTO invites (token, from_id, expire_at, used) VALUES (?, ?, ?, 0)', [token, from, expireAt]);
  };

  base.takeInvite = async function takeInvite(token) {
    const row = await base.one('SELECT * FROM invites WHERE token = ?', [token]);
    if (!row || row.used || Number(row.expire_at) < Date.now()) {
      return null;
    }
    await base.run('UPDATE invites SET used = 1 WHERE token = ?', [token]);
    return row;
  };

  /* ---------- 订阅额度与发送记录 ---------- */

  base.addQuota = async function addQuota(openid, templateId, n) {
    const now = Date.now();
    if (base.driver === 'mysql') {
      await base.run(
        'INSERT INTO push_quota (openid, template_id, count, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE count = count + VALUES(count), updated_at = VALUES(updated_at)',
        [openid, templateId, n, now]
      );
    } else {
      await base.run(
        'INSERT INTO push_quota (openid, template_id, count, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (openid, template_id) DO UPDATE SET count = push_quota.count + excluded.count, updated_at = excluded.updated_at',
        [openid, templateId, n, now]
      );
    }
  };

  base.quotaOf = async function quotaOf(openid, templateId) {
    const row = await base.one('SELECT count FROM push_quota WHERE openid = ? AND template_id = ?', [openid, templateId]);
    return Number(row?.count || 0);
  };

  base.consumeQuota = async function consumeQuota(openid, templateId) {
    await base.run(
      'UPDATE push_quota SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE openid = ? AND template_id = ?',
      [openid, templateId]
    );
  };

  base.markPushed = async function markPushed(openid, type, day) {
    try {
      await base.run('INSERT INTO push_logs (openid, type, day, sent_at) VALUES (?, ?, ?, ?)', [openid, type, day, Date.now()]);
      return true;
    } catch {
      return false; // 主键冲突 = 今天已经发过
    }
  };

  // 发送失败时撤销占位，否则这一天的提醒名额会被白白吃掉
  base.clearPushed = async function clearPushed(openid, type, day) {
    await base.run('DELETE FROM push_logs WHERE openid = ? AND type = ? AND day = ?', [openid, type, day]);
  };

  base.pushedToday = async function pushedToday(openid, type, day) {
    const row = await base.one('SELECT 1 AS x FROM push_logs WHERE openid = ? AND type = ? AND day = ?', [openid, type, day]);
    return !!row;
  };

  /* ---------- 统计用：取一批用户近 N 天的记录 ---------- */

  base.recordsSince = async function recordsSince(ids, sinceTs) {
    if (!ids.length) {
      return [];
    }
    const marks = ids.map(() => '?').join(',');
    return base.all(
      `SELECT openid, ts, duration_min FROM records
       WHERE openid IN (${marks}) AND deleted = 0 AND ts >= ?
       ORDER BY ts DESC`,
      [...ids, sinceTs]
    );
  };

  return base;
}
