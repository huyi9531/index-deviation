set -u
PX="http://127.0.0.1:7897"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
O=".smoke/_stockprobe/raw"; mkdir -p "$O"
LIST="
600519.SS|贵州茅台
300750.SZ|宁德时代
601857.SS|中国石油
601012.SS|隆基绿能
000725.SZ|京东方A
000002.SZ|万科A
600030.SS|中信证券
300104.SZ|乐视网(退市)
000979.SZ|中弘退
AAPL|苹果
NVDA|英伟达
INTC|英特尔
GE|通用电气
KO|可口可乐
BBBYQ|BedBath(退市)
LEHMQ|雷曼(退市)
"
echo "$LIST" | while IFS='|' read -r sym name; do
  [ -z "$sym" ] && continue
  f="$O/${sym}.json"
  ok=0
  for attempt in 1 2 3; do
    code=$(curl -s -x "$PX" --max-time 30 -A "$UA" -o "$f" -w "%{http_code}" \
      "https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=0&period2=9999999999&interval=1d&events=div%2Csplit&includeAdjustedClose=true")
    if [ "$code" = "200" ] && [ -s "$f" ]; then ok=1; break; fi
    sleep 3
  done
  res=$(node -e "
try{const j=require('./$f');const e=j?.chart?.error;
if(e){console.log('ERR '+JSON.stringify(e).slice(0,60));process.exit(0)}
const r=j?.chart?.result?.[0];const t=r?.timestamp;
if(!t?.length){console.log('EMPTY');process.exit(0)}
console.log('OK '+t.length+' bars '+new Date(t[0]*1000).toISOString().slice(0,10)+' → '+new Date(t[t.length-1]*1000).toISOString().slice(0,10)+' '+(r.indicators?.adjclose?'adj':'NOADJ'))
}catch(x){console.log('BADJSON')}" 2>/dev/null)
  printf "%-16s %-12s http=%s  %s\n" "$name" "$sym" "$code" "$res"
  sleep 1.5
done
