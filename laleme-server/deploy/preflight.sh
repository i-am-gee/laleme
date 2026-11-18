#!/usr/bin/env bash
# 部署前体检：确认机器能撑住「Node + MySQL + nginx」，并核对域名解析。
# 用法：bash preflight.sh api.laleme.ariel.today
set -uo pipefail

DOMAIN="${1:-}"

line() { printf '%-22s %s\n' "$1" "$2"; }

echo "== 机器 =="
line "系统" "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo unknown)"
line "内核" "$(uname -r)"
line "CPU" "$(nproc) 核"
line "内存" "$(free -m | awk 'NR==2{printf "%d MB（可用 %d MB）", $2, $7}')"
line "磁盘" "$(df -h / | awk 'NR==2{printf "%s 可用 / %s", $4, $2}')"

echo
echo "== 端口占用 =="
for p in 80 443 3000 3306; do
  if ss -lntp 2>/dev/null | grep -q ":${p} "; then
    line "$p 端口" "已被占用：$(ss -lntp 2>/dev/null | grep ":${p} " | awk '{print $6}' | head -1)"
  else
    line "$p 端口" "空闲"
  fi
done

echo
echo "== 已装组件 =="
for c in node npm nginx mysql certbot git; do
  v=$(command -v "$c" >/dev/null 2>&1 && ("$c" -v 2>&1 | head -1) || echo "未安装")
  line "$c" "$v"
done

echo
echo "== 域名 =="
if [[ -n "$DOMAIN" ]]; then
  ip=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)
  line "$DOMAIN" "${ip:-解析失败}"
  pub=$(curl -s -m 6 https://api.ipify.org || echo "")
  line "本机公网 IP" "${pub:-未知}"
  if [[ -n "$ip" && -n "$pub" && "$ip" == "$pub" ]]; then
    line "结论" "解析正确，可以签证书"
  else
    line "结论" "解析与本机不一致，先改 A 记录"
  fi
else
  line "域名" "未传入，跳过"
fi

echo
echo "== 结论 =="
mem=$(free -m | awk 'NR==2{print $2}')
if [[ "$mem" -lt 1800 ]]; then
  echo "内存偏小（${mem}MB）：MySQL 建议把 innodb_buffer_pool_size 调到 256M，并加 1G swap"
else
  echo "资源够用，可直接部署"
fi
