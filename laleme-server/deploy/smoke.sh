#!/usr/bin/env bash
# 上线冒烟：对着一套真实部署跑最小闭环，只看「通不通」，不改业务数据。
#
# 用法：
#   bash smoke.sh https://api.laleme.ariel.today
#   bash smoke.sh http://8.153.164.6          # 域名未通时的临时验证
#
# 带令牌时会额外验证受保护接口：
#   TOKEN=xxx bash smoke.sh https://api.laleme.ariel.today

set -uo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "用法：bash smoke.sh <baseUrl>" >&2
  exit 2
fi

pass=0
fail=0

ok()   { pass=$((pass+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; [[ -n "${2:-}" ]] && printf '      %s\n' "$2"; }

# 期望状态码：check <名称> <期望> <curl 参数...>
check() {
  local name="$1" want="$2"; shift 2
  local out code
  out=$(curl -s -m 12 -o /tmp/smoke.body -w '%{http_code}' "$@" 2>/dev/null)
  code="$out"
  if [[ "$code" == "$want" ]]; then
    ok "${name}（${code}）"
  else
    bad "${name}（期望 ${want}，实际 ${code}）" "$(head -c 160 /tmp/smoke.body 2>/dev/null)"
  fi
}

echo "== 基础 =="
check "健康检查" 200 "$BASE/api/health"
check "模板下发" 200 "$BASE/api/push/templates"

echo
echo "== 鉴权 =="
check "无 code 登录被拒" 400 -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{}'
check "无令牌拉取被拒" 401 "$BASE/api/sync/pull?since=0"
check "伪造令牌被拒" 401 "$BASE/api/sync/pull?since=0" -H 'Authorization: Bearer forged.token'

echo
echo "== 定时任务 =="
check "无密钥触发 cron 被拒" 403 -X POST "$BASE/api/cron/daily"

if [[ -n "${TOKEN:-}" ]]; then
  echo
  echo "== 带令牌的业务接口 =="
  AUTH="Authorization: Bearer $TOKEN"
  check "好友列表" 200 "$BASE/api/friends" -H "$AUTH"
  check "排名" 200 "$BASE/api/friends/rank" -H "$AUTH"
  check "提醒状态" 200 "$BASE/api/push/status" -H "$AUTH"
  check "增量拉取" 200 "$BASE/api/sync/pull?since=0" -H "$AUTH"
fi

echo
echo "== 网络与证书 =="
if curl -s -m 8 -o /dev/null -w '%{http_code}' "$BASE/api/health" | grep -q 200; then
  if [[ "$BASE" == https://* ]]; then
    expire=$(echo | openssl s_client -servername "$(echo "$BASE" | sed 's|https://||;s|/.*||')" \
      -connect "$(echo "$BASE" | sed 's|https://||;s|/.*||'):443" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    [[ -n "$expire" ]] && ok "证书有效期至 ${expire}" || bad "取不到证书信息"
  else
    echo "  （http 地址，跳过证书检查）"
  fi
fi

echo
printf '结果：%d 通过，%d 失败\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] || exit 1
