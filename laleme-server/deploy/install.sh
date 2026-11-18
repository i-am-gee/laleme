#!/usr/bin/env bash
# 拉了么服务端 · 一键部署（Ubuntu 22.04 / 24.04）
#
# 用法（在服务器上以 root 执行）：
#   bash install.sh                      # 只装服务，监听 127.0.0.1:3000
#   bash install.sh api.example.com      # 同时配 nginx 反代 + 申请证书
#
# 假设代码已经放在 /opt/laleme-server（本脚本所在目录的上一级）。

set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="/opt/laleme-server"
ENV_FILE="/etc/laleme-server.env"
SERVICE="laleme-server"
NODE_PORT=3000
DB_NAME="laleme"
DB_USER="laleme"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "请用 root 执行（或 sudo bash install.sh）" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/src/index.js" ]]; then
  echo "找不到 $APP_DIR/src/index.js，请先把 laleme-server 目录上传到 $APP_DIR" >&2
  exit 1
fi

log "1/7 安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx mysql-server >/dev/null

log "2/7 安装 Node.js 20"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

log "3/7 准备数据库"
systemctl enable --now mysql >/dev/null
DB_PASSWORD="$(openssl rand -hex 16)"
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "数据库就绪：${DB_NAME} / ${DB_USER}"

log "4/7 写入环境变量"
cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=${NODE_PORT}
DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
ENV
chmod 600 "$ENV_FILE"

log "5/7 安装依赖并创建 systemd 服务"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund >/dev/null

cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=laleme server (sync api)
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=3
User=www-data
Group=www-data

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}
StandardOutput=append:/var/log/${SERVICE}.log
StandardError=append:/var/log/${SERVICE}.log

[Install]
WantedBy=multi-user.target
UNIT

chown -R www-data:www-data "$APP_DIR"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 2
curl -fsS "http://127.0.0.1:${NODE_PORT}/api/health" && echo

log "6/7 配置 nginx 反代"
if [[ -n "$DOMAIN" ]]; then
  cat > "/etc/nginx/sites-available/${SERVICE}" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 2m;
    proxy_read_timeout 30s;

    location / {
        proxy_pass http://127.0.0.1:${NODE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  ln -sf "/etc/nginx/sites-available/${SERVICE}" "/etc/nginx/sites-enabled/${SERVICE}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  log "7/7 申请证书（需要域名已解析到本机）"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect || {
    echo "证书申请失败：确认 ${DOMAIN} 已 A 记录指向本机，且 80 端口放行。" >&2
  }
else
  rm -f /etc/nginx/sites-enabled/default
  systemctl reload nginx || true
  log "7/7 跳过域名与证书（未传参数）"
fi

cat <<DONE

部署完成。

  服务状态   systemctl status ${SERVICE}
  实时日志   tail -f /var/log/${SERVICE}.log
  本机自检   curl http://127.0.0.1:${NODE_PORT}/api/health
  环境变量   ${ENV_FILE}（含数据库密码，权限 600）

下一步：
  1. 云控制台安全组只放行 22 / 80 / 443，其它端口一律关闭
  2. 小程序后台 → 开发管理 → 服务器域名 → request 合法域名填 https://${DOMAIN:-你的域名}
  3. 小程序端在 storage 里写 laleme_cloud 配置：
     { enabled: true, mode: 'http', baseUrl: 'https://${DOMAIN:-你的域名}' }
DONE
