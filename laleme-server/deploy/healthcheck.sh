#!/usr/bin/env bash
# 拉了么 · 服务端体检
# 每 5 分钟由 systemd timer 触发；异常时写入本地告警日志，并推送到企业微信群机器人（配了才发）。
#
# 告警配置：/etc/laleme-alert.env
#   WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
#
# 设计原则：
#   1. 同一个问题不刷屏——状态没变就静默，变了立刻发，且同类最多每小时一次
#   2. 恢复时发一条「已恢复」，避免误以为还在故障
#   3. 任何一项检查失败都不中断后续检查

set -uo pipefail

ALERT_LOG="/var/log/laleme-alert.log"
STATE_FILE="/var/lib/laleme-health.state"
APP_LOG="/var/log/laleme-server.log"
ENV_FILE="/etc/laleme-alert.env"

[[ -f "$ENV_FILE" ]] && . "$ENV_FILE"
WEBHOOK_URL="${WEBHOOK_URL:-}"

# 自测：发一条测试消息，验证 webhook 通不通（不影响状态文件）
if [[ "${1:-}" == "--test" ]]; then
  if [[ -z "$WEBHOOK_URL" ]]; then
    echo "未配置 WEBHOOK_URL，告警只会写本地日志：$ALERT_LOG"
    exit 2
  fi
  payload=$(printf '【拉了么】告警通道测试\n时间：%s\n收到这条说明配置成功。' "$(date '+%F %T')" \
    | python3 -c 'import json,sys; print(json.dumps({"msgtype":"text","text":{"content":sys.stdin.read()}}))')
  resp=$(curl -s -m 8 -X POST "$WEBHOOK_URL" -H 'content-type: application/json' -d "$payload")
  echo "返回：$resp"
  echo "$resp" | grep -q '"errcode":0' && exit 0 || exit 1
fi

problems=()
warns=()

add_problem() { problems+=("$1"); }
add_warn()    { warns+=("$1"); }

# ---------- 1. 服务存活 ----------
for svc in laleme-server nginx mysql; do
  if ! systemctl is-active --quiet "$svc"; then
    add_problem "服务未运行：$svc"
  fi
done

# ---------- 2. 接口可用 ----------
body=$(curl -s -m 6 http://127.0.0.1:3000/api/health 2>/dev/null)
if [[ -z "$body" ]]; then
  add_problem "健康接口无响应（127.0.0.1:3000）"
elif ! echo "$body" | grep -q '"ok":true'; then
  add_problem "健康接口返回异常：$(echo "$body" | head -c 80)"
elif ! echo "$body" | grep -q '"driver":"mysql"'; then
  add_problem "服务连的不是 MySQL：$(echo "$body" | head -c 80)"
fi

# ---------- 3. 磁盘与内存 ----------
disk=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
[[ "$disk" -ge 85 ]] && add_problem "磁盘使用率 ${disk}%"
[[ "$disk" -ge 70 && "$disk" -lt 85 ]] && add_warn "磁盘使用率 ${disk}%"

mem_avail=$(free -m | awk 'NR==2{print $7}')
[[ "$mem_avail" -lt 80 ]] && add_problem "可用内存仅 ${mem_avail}MB"
[[ "$mem_avail" -ge 80 && "$mem_avail" -lt 150 ]] && add_warn "可用内存偏低 ${mem_avail}MB"

# ---------- 4. 证书 ----------
certdir="/etc/letsencrypt/live/api.laleme.ariel.today"
if [[ -f "$certdir/fullchain.pem" ]]; then
  end=$(openssl x509 -enddate -noout -in "$certdir/fullchain.pem" | cut -d= -f2)
  end_ts=$(date -d "$end" +%s 2>/dev/null || echo 0)
  days=$(( (end_ts - $(date +%s)) / 86400 ))
  [[ "$days" -lt 7 ]] && add_problem "证书 ${days} 天后到期"
  [[ "$days" -ge 7 && "$days" -lt 20 ]] && add_warn "证书 ${days} 天后到期"
fi

# ---------- 5. 推送失败率 ----------
if [[ -f "$APP_LOG" ]]; then
  fails=$(grep -c 'push:fail' "$APP_LOG" 2>/dev/null || echo 0)
  errors=$(grep -c '\[error\]' "$APP_LOG" 2>/dev/null || echo 0)
  [[ "$errors" -gt 20 ]] && add_warn "日志中累计 $errors 条 5xx 错误"
  [[ "$fails" -gt 50 ]] && add_warn "日志中累计 $fails 条推送失败（多为未授权，持续增长需排查）"
fi

# ---------- 6. 备份 ----------
latest=$(ls -t /root/backup-*.sql.gz 2>/dev/null | head -1)
if [[ -z "$latest" ]]; then
  add_warn "尚无数据库备份"
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
  [[ "$age_h" -gt 36 ]] && add_problem "最近备份已是 ${age_h} 小时前"
fi

# ---------- 汇总 ----------
now=$(date '+%F %T')
status="ok"
[[ ${#warns[@]} -gt 0 ]] && status="warn"
[[ ${#problems[@]} -gt 0 ]] && status="error"

problems_str=""
warns_str=""
[[ ${#problems[@]} -gt 0 ]] && problems_str=$(printf '%s；' "${problems[@]}")
[[ ${#warns[@]} -gt 0 ]] && warns_str=$(printf '%s；' "${warns[@]}")

# 状态没变且不是 error 时不打扰
prev_status=$(cut -d'|' -f1 "$STATE_FILE" 2>/dev/null || echo "")
prev_time=$(cut -d'|' -f2 "$STATE_FILE" 2>/dev/null || echo 0)
now_ts=$(date +%s)

should_alert=0
if [[ "$status" == "error" ]]; then
  if [[ "$status" != "$prev_status" ]]; then
    should_alert=1
  elif (( now_ts - ${prev_time:-0} > 3600 )); then
    should_alert=1
  fi
elif [[ "$status" == "warn" && "$prev_status" == "error" ]]; then
  should_alert=1
elif [[ "$status" == "ok" && "$prev_status" == "error" ]]; then
  should_alert=1
fi

mkdir -p "$(dirname "$STATE_FILE")"
echo "${status}|${now_ts}" > "$STATE_FILE"

if [[ "$status" != "ok" ]]; then
  echo "${now} [${status}] ${problems_str}${warns_str}" >> "$ALERT_LOG"
fi

if [[ "$should_alert" -eq 1 ]]; then
  if [[ "$status" == "ok" ]]; then
    msg="【拉了么】服务已恢复
时间：${now}"
  elif [[ "$status" == "warn" ]]; then
    msg="【拉了么】服务降级（自动恢复中）
时间：${now}
${warns_str}"
  else
    msg="【拉了么】服务异常
时间：${now}
问题：${problems_str}
提示：${warns_str}"
  fi

  echo "${now} 发送告警：${status}" >> "$ALERT_LOG"

  if [[ -n "$WEBHOOK_URL" ]]; then
    payload=$(printf '%s' "$msg" \
      | python3 -c 'import json,sys; print(json.dumps({"msgtype":"text","text":{"content":sys.stdin.read()}}))')
    curl -s -m 8 -X POST "$WEBHOOK_URL" -H 'content-type: application/json' -d "$payload" >/dev/null 2>&1
  fi
fi

[[ "$status" == "ok" ]] && exit 0 || exit 1
