# 部署手册 · 8.153.164.6

**环境**：Ubuntu 22.04（OpenSSH 8.9p1）　**服务**：Node + MySQL + nginx　**代码**：`/opt/laleme-server`

---

## 零、两个必须先解决的阻断项

### 1）小程序正式版不能用 IP + HTTP

微信小程序 `wx.request` 只认 **HTTPS + 已备案域名**，并且域名要填进「开发管理 → 服务器域名 → request 合法域名」。IP 地址不能作为合法域名。

所以：

| 阶段 | 能否用 IP | 做法 |
|---|---|---|
| 开发者工具 / 体验版 | 能 | 勾「不校验合法域名」，直连 `http://8.153.164.6:3000` |
| 正式版 | **不能** | 必须有域名 + 备案 + HTTPS 证书 |

**域名路径**：在腾讯云买一个域名（`.com` 约 60–80 元/年）→ 提交 ICP 备案（个人可备，需 3–10 个工作日）→ A 记录指向 8.153.164.6 → 用 `certbot` 免费签证书（脚本里已带）。

> 备案要求服务器在腾讯云且有余量：现在这台机器就满足条件，别先解绑。

### 2）安全组要收口

默认安全组常把端口放得很宽。上线前请确认只放行 **22 / 80 / 443**，MySQL 的 3306 绝不能对公网开放（脚本里数据库只监听 127.0.0.1）。

---

## 一、先把部署公钥装上（一次性）

在腾讯云控制台点「登录」（网页终端），执行：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHqPMDEc0z88aBqpA51Zlog264CwcC8K46+hmAQbjsZ laleme-deploy@JFCSHALAP707" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

装好之后，本机即可免密执行：

```bash
ssh -i ~/.ssh/laleme_deploy root@8.153.164.6
```

---

## 二、上传代码并安装

```bash
# 本机
scp -i ~/.ssh/laleme_deploy -r laleme-server root@8.153.164.6:/opt/

# 服务器
ssh -i ~/.ssh/laleme_deploy root@8.153.164.6
bash /opt/laleme-server/deploy/install.sh            # 无域名：只起服务，监听 127.0.0.1:3000
bash /opt/laleme-server/deploy/install.sh api.xxx.com  # 有域名：同时配 nginx + 证书
```

脚本做七件事：装 nginx/mysql/node20 → 建库建账号（随机密码写进 `/etc/laleme-server.env`，权限 600）→ `npm install` → 写 systemd 单元 → 起服务并自检 `/api/health` → 配 nginx 反代 → 申请证书。

---

## 二·补、配置小程序密钥（必做）

服务端用 `wx.login` 的 code 换 openid，需要 AppID 与 AppSecret：

```bash
ssh -i ~/.ssh/laleme_deploy root@8.153.164.6
# AppID 已写入，只需补 AppSecret（在公众平台「开发管理 → 开发设置」里重置后复制）
sed -i 's|^WX_SECRET=.*|WX_SECRET=你的AppSecret|' /etc/laleme-server.env
systemctl restart laleme-server
```

> 身份鉴权已从「信任 X-WX-OPENID 头」改为「微信登录 + 服务端签名令牌」。
> 原因是自建服务器上任何客户端都能伪造该头，等于任何人可冒充任意用户。

## 三、验证

```bash
systemctl status laleme-server
curl http://127.0.0.1:3000/api/health          # {"ok":true,"driver":"mysql"}
curl https://<域名>/api/health                  # 经 nginx + 证书
tail -f /var/log/laleme-server.log
```

---

## 四、小程序端切换

小程序启动后，在 `storage` 里写一次配置（或在代码里写死默认值）：

```js
wx.setStorageSync('laleme_cloud', {
  enabled: true,
  mode: 'http',                    // 直连模式（含 https）
  baseUrl: 'https://api.xxx.com',  // 没域名前：http://8.153.164.6:3000 + 开发者工具关校验
  cursor: 0,
  lastSync: 0,
});
```

然后在「我的 → 云同步」打开开关，首次会弹窗说明并全量上传。

---

## 四·补、告警与体检

每 5 分钟自动体检一次（`systemctl list-timers 'laleme-*'` 可看下次时间）：

| 检查项 | 触发条件 |
|---|---|
| 三个服务是否在跑 | `laleme-server` / `nginx` / `mysql` 任一不是 active |
| 接口可用性 | `/api/health` 无响应或 `driver` 不是 mysql |
| 磁盘 / 内存 | 磁盘 ≥85% 或可用内存 <80MB |
| 证书 | 剩余 <7 天 |
| 备份 | 最近备份超过 36 小时或没有 |
| 日志 | 5xx 超过 20 条、推送失败超过 50 条（仅提示） |

配置推送（企业微信群机器人）：

```bash
vi /etc/laleme-alert.env
# WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
```

不填也可以，告警会写进 `/var/log/laleme-alert.log`。

机制：状态变化时立刻推送；**持续故障每 60 分钟重提醒一次**；恢复时发一条「已恢复」；状态不变且不是故障时不写日志、不推送。

状态文件 `/var/lib/laleme-health.state` 为三段式 `结论|故障起始|上次推送`，第二、三段分别只在状态变化与真正推送时更新——**这是重提醒能工作的前提**（早期版本每次都刷新时间戳，导致长故障只会响一次）。

可调环境变量（调试与自测用）：

| 变量 | 默认 | 用途 |
|---|---|---|
| `HEALTH_URL` | `http://127.0.0.1:3000/api/health` | 改指向一个关闭的端口即可造出 error 状态，无需停真实服务 |
| `HEALTH_REPEAT_SECONDS` | `3600` | 重提醒间隔 |
| `HEALTH_DRY_RUN` | `0` | 设 1 则只写日志、不推群 |
| `STATE_FILE` / `ALERT_LOG` | `/var/lib/laleme-health.state` / `/var/log/laleme-alert.log` | 沙箱测试时改到 `/tmp`，不影响线上状态 |

自测示例（不打扰群）：

```bash
env STATE_FILE=/tmp/t.state ALERT_LOG=/tmp/t.log HEALTH_DRY_RUN=1 \
  HEALTH_URL=http://127.0.0.1:9 HEALTH_REPEAT_SECONDS=1 \
  /usr/local/bin/laleme-healthcheck.sh
```

## 五、日常运维

| 事项 | 命令 |
|---|---|
| 看状态 | `systemctl status laleme-server` |
| 重启 | `systemctl restart laleme-server` |
| 看日志 | `tail -f /var/log/laleme-server.log` |
| 改配置 | 编辑 `/etc/laleme-server.env` 后重启 |
| 备份数据库 | `mysqldump -u laleme -p laleme > /root/backup-$(date +%F).sql` |
| 续证书 | `certbot renew`（脚本已装，可加 cron） |

**建议加一条每日备份**：

```bash
cat > /etc/cron.daily/laleme-backup <<'EOF'
#!/bin/sh
source /etc/laleme-server.env
mysqldump -h127.0.0.1 -u$DB_USER -p$DB_PASSWORD $DB_NAME | gzip > /root/backup-$(date +%F).sql.gz
find /root -name 'backup-*.sql.gz' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/laleme-backup
```

---

## 六、已知限制

- 服务端是单机部署，没有做高可用；挂了会影响同步，但**不影响本地记录**（本地优先）
- 没有做限流与防刷；用户量上来之前够用，之后要在 nginx 层加 `limit_req`
- MySQL 与应用同机，内存紧张时优先看 `free -m`，2G 机器建议把 `innodb_buffer_pool_size` 调到 256M
