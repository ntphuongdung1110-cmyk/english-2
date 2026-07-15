#!/usr/bin/env bash
# Tải 1 ảnh minh họa/chủ đề về images/topic-XX.jpg (nguồn free theo từ khóa: loremflickr).
# Từ khóa lấy từ enrich-content.js (IMG_KEYWORDS).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images

# In ra "index<TAB>keyword" từ enrich-content.js
node -e '
const {IMG_KEYWORDS}=require("./enrich-content.js");
for(const [i,kw] of Object.entries(IMG_KEYWORDS)) console.log(i+"\t"+kw);
' | while IFS=$'\t' read -r i kw; do
  n=$(printf "%02d" "$i")
  out="images/topic-$n.jpg"
  if [ -s "$out" ] && [ "${1:-}" != "--fresh" ]; then
    echo "skip $out (đã có)"; continue
  fi
  url="https://loremflickr.com/640/300/${kw}"
  code=$(curl -sL -m 25 -o "$out" -w "%{http_code}" "$url" || echo "ERR")
  sz=$(wc -c < "$out" 2>/dev/null | tr -d ' ')
  if [ "$code" = "200" ] && [ "${sz:-0}" -gt 2000 ]; then
    echo "ok   $out  [$kw]  ${sz}B"
  else
    echo "FAIL $out  [$kw]  http=$code size=${sz:-0}"
  fi
  sleep 0.4
done
echo "--- done ---"
ls -la images/ | tail -n +2 | wc -l | xargs echo "tổng file ảnh:"
