for pid in $(ls /proc/ | grep -E '^[0-9]+$'); do
  cmdline=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\0' ' ')
  if echo "$cmdline" | grep -q uvicorn 2>/dev/null; then
    echo "PID $pid: $cmdline"
    cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep PATH
    break
  fi
done
