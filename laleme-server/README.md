# 拉了么 · 服务端（M1）

账号与记录同步。目标只有一个：**清缓存、换手机之后，记录还能回来。**

## 现状

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 登录 + 记录同步（推/拉/软删/冲突） | 代码与测试完成，待部署 |
| M2 | 订阅消息：每日打卡提醒 | 未开始 |
| M3 | 好友关系 + 排名 | 未开始 |
| M4 | 好友打卡提醒（每天一次） | 未开始 |

## 本地跑

```bash
cd laleme-server
node --experimental-sqlite test/m1.test.js       # 接口级 14 项
node --experimental-sqlite test/sync-e2e.mjs     # 端到端 5 项（真起服务 + 客户端桩）
npm run dev                                       # 起服务，默认 3100 端口，内存 SQLite
```

`npm run dev` 之后，在小程序 `laleme_cloud` 里把 `mode` 设成 `http`、`baseUrl` 设成
`http://127.0.0.1:3100`，开发者工具勾选「不校验合法域名」，即可在模拟器里跑通全链路。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查，返回驱动类型 |
| POST | `/api/login` | 建档/更新昵称，返回 profile 与云端记录数 |
| POST | `/api/sync/push` | 批量 upsert，单次 ≤200 条，幂等 |
| GET | `/api/sync/pull?since=&limit=` | 增量拉取，返回 `cursor` 与 `hasMore` |

身份：云托管会自动注入 `X-WX-OPENID` 请求头，服务端直接信任；本地开发用
`ALLOW_DEBUG_AUTH=1` + `x-debug-openid` 模拟。

## 数据模型

```
users(openid PK, nick, avatar, settings, created_at, updated_at)
records(id PK, openid, client_id, ts, duration_min, bristol, mood, color,
        deleted, updated_at, UNIQUE(openid, client_id))
devices(openid, client_id, last_sync)
```

## 同步规则

- **本地优先**：写本地立即反馈，异步推云端；云端不可用不影响记录
- **幂等**：`(openid, client_id)` 唯一，重复推送不产生副本
- **冲突**：同一条以 `updatedAt` 大者为准（LWW）
- **删除**：端上留墓碑，推到云端后置 `deleted=1`，其他设备拉取时删除本地

## 部署到微信云托管

1. 微信公众平台 → 云托管 → 新建服务，选「自定义部署」，服务名填 `laleme-server`
2. 数据库：云托管控制台的「数据库」里开通 MySQL（最低规格即可），记录内网地址与账号
3. 服务环境变量：

   ```
   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
   NODE_ENV=production
   PORT=80
   ```

4. 上传本目录（Dockerfile 已在根），或关联 Git 仓库自动构建
5. 等实例起来后访问 `/api/health` 应返回 `{"ok":true,"driver":"mysql"}`
6. 小程序端：`laleme_cloud` 配 `mode: container`、`env: <环境ID>`、`service: laleme-server`

> 首次上线前要把云端 MySQL 的表建好：服务启动时会自动执行建表语句，无需手动迁移。

## 成本

云托管按实例规格与调用计费，最小 0.25 核 512MB 约 30–60 元/月；MySQL 最低规格约 30–50 元/月。
用户量在千人以内的阶段，这两项是主要开销。
