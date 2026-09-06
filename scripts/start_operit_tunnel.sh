#!/usr/bin/env bash
# ============================================================
# start_operit_tunnel.sh — P0-2 M1-a 隧道固化启动脚本
# 职责：把「setsid 启动 cloudflared → 拿 trycloudflare URL → 写 Supabase
#       system_config(operit_tunnel_url) → 输出状态」固化成可重复流程。
# 用途：每次需要唤醒链路可用时运行一次；隧道进程被回收后重新拉起。
#
# 用法：bash scripts/start_operit_tunnel.sh
# 前置：env 需提供 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（或 SUPA_URL / SUPA_KEY 简写）
#       和 OPERIT_BEARER_TOKEN（写 system_config 用，缺省则只更新 URL 不动 token）
#
# 参考（哥哥实测 2026-09-06）：code_runner 里 setsid + start_new_session + 输出重定向文件
#   可以让 cloudflared 跨脚本存活一段时间（非永久，需重启时重新拉起）。
# v1 (2026-09-06)：固化启动流程
# ============================================================
set -euo pipefail

CLOUDFLARED="${CLOUDFLARED:-/usr/local/bin/cloudflared}"
TARGET_URL="${TARGET_URL:-http://localhost:8094}"
SUPA_URL="${SUPA_URL:-${SUPABASE_URL:-}}"
SUPA_KEY="${SUPA_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
BEARER_TOKEN="${OPERIT_BEARER_TOKEN:-}"
LOG_FILE="${TUNNEL_LOG:-/tmp/operit_tunnel.log}"
URL_FILE="${TUNNEL_URL_FILE:-/tmp/operit_tunnel_url.txt}"
PID_FILE="${TUNNEL_PID_FILE:-/tmp/operit_tunnel.pid}"

echo "==> [1/5] 检查 cloudflared"
if [ ! -x "$CLOUDFLARED" ]; then
  echo "ERROR: cloudflared 不存在于 $CLOUDFLARED" >&2
  exit 1
fi
echo "    OK: $($CLOUDFLARED --version 2>&1 | head -1)"

echo "==> [2/5] 清理旧实例（避免多隧道并存）"
if [ -f "$PID_FILE" ]; then
  old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "    杀掉旧实例 PID=$old_pid"
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi
# 兜底：清理仍在跑的 cloudflared tunnel 进程（只清指向本目标 URL 的，避免误杀）
pkill -f "cloudflared tunnel --url $TARGET_URL" 2>/dev/null || true

echo "==> [3/5] setsid 启动 cloudflared（输出重定向到 $LOG_FILE）"
rm -f "$LOG_FILE"
setsid "$CLOUDFLARED" tunnel --url "$TARGET_URL" --no-autoupdate >"$LOG_FILE" 2>&1 &
new_pid=$!
echo "    PID=$new_pid"
echo "$new_pid" > "$PID_FILE"

echo "==> [4/5] 等待并提取 trycloudflare URL"
URL=""
for i in $(seq 1 30); do
  if [ -f "$LOG_FILE" ]; then
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)
    if [ -n "$URL" ]; then break; fi
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "ERROR: 未能提取 trycloudflare URL，日志尾部：" >&2
  tail -20 "$LOG_FILE" >&2
  exit 1
fi
echo "    URL: $URL"
echo "$URL" > "$URL_FILE"

echo "==> [5/5] 写 Supabase system_config（operit_tunnel_url）"
if [ -z "$SUPA_URL" ] || [ -z "$SUPA_KEY" ]; then
  echo "    WARN: 缺 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY，跳过写库。"
  echo "    URL 已存 $URL_FILE，请在 Operit 里用 ziven_mcp:supabase_db 手动更新："
  echo "      action=update table=system_config filters={key:operit_tunnel_url} data={value:$URL}"
else
  # PATCH 更新 operit_tunnel_url，用响应体判断是否真更新
  resp=$(curl -s -X PATCH "$SUPA_URL/rest/v1/system_config?key=eq.operit_tunnel_url" \
    -H "apikey: $SUPA_KEY" \
    -H "Authorization: Bearer $SUPA_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{\"value\":\"$URL\",\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}" 2>/dev/null || true)
  if echo "$resp" | grep -q "\"value\":\"$URL\""; then
    echo "    ✅ 已更新 operit_tunnel_url=$URL"
  else
    echo "    WARN: 更新 operit_tunnel_url 失败。响应：${resp:0:200}"
    echo "    URL 已存 $URL_FILE，请用 ziven_mcp:supabase_db 手动更新。"
  fi
  # 若给了 token，则也确认写入（缺省跳过）
  if [ -n "$BEARER_TOKEN" ]; then
    resp2=$(curl -s -X PATCH "$SUPA_URL/rest/v1/system_config?key=eq.operit_bearer_token" \
      -H "apikey: $SUPA_KEY" \
      -H "Authorization: Bearer $SUPA_KEY" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=representation" \
      -d "{\"value\":\"$BEARER_TOKEN\"}" 2>/dev/null || true)
    if echo "$resp2" | grep -q "\"value\":\"$BEARER_TOKEN\""; then
      echo "    ✅ 已确认 operit_bearer_token"
    else
      echo "    WARN: 更新 operit_bearer_token 失败（可跳过，token 已在库）"
    fi
  fi
fi

echo ""
echo "==== 状态 JSON ===="
cat <<JSON
{
  "provider": "trycloudflare",
  "endpoint": "$URL",
  "pid": "$new_pid",
  "pid_file": "$PID_FILE",
  "log_file": "$LOG_FILE",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
JSON
echo "==== 完成 ===="
