set -u
PX="http://127.0.0.1:7897"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
OUT=".smoke/_stockprobe/stocks"; mkdir -p "$OUT"
ok=0; skip=0; fail=0
while IFS=$'\t' read -r mkt code name; do
  [ -z "${code:-}" ] && continue
  sym=$([ "$mkt" = "1" ] && echo "${code}.SS" || echo "${code}.SZ")
  f="$OUT/${sym}.json"
  if [ -s "$f" ]; then skip=$((skip+1)); continue; fi
  got=0
  for attempt in 1 2 3; do
    http=$(curl -s -x "$PX" --max-time 30 -A "$UA" -o "$f" -w "%{http_code}" \
      "https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=0&period2=9999999999&interval=1d&events=div%2Csplit&includeAdjustedClose=true")
    if [ "$http" = "200" ] && [ -s "$f" ] && node -e "const j=require('./$f');process.exit(j?.chart?.result?.[0]?.timestamp?.length?0:1)" 2>/dev/null; then got=1; break; fi
    rm -f "$f"; sleep 2
  done
  if [ "$got" = "1" ]; then ok=$((ok+1)); else fail=$((fail+1)); echo "  失败: $sym $name"; fi
  sleep 0.5
done < .smoke/_stockprobe/hs300.tsv
echo "新增 $ok / 已有 $skip / 失败 $fail"
