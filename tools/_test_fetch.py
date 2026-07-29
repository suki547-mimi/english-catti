"""Test if we can fetch ChinaDaily article directly with requests."""
import requests, sys, time
URL = "https://language.chinadaily.com.cn/a/202505/07/WS681b18fba310a04af22bdeef.html"
HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
t0 = time.time()
r = requests.get(URL, headers=HDR, timeout=15)
dt = time.time() - t0
r.encoding = r.apparent_encoding or "utf-8"
html = r.text
print(f"status={r.status_code}  bytes={len(html)}  time={dt:.2f}s")
print(f"encoding={r.encoding}")
# quick markers to confirm we got the real content
markers = ["每日一词", "全国总工会", "All-China Federation", "相关词汇"]
for m in markers:
    print(f"  contains '{m}': {m in html}")
