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
