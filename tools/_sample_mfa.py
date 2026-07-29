"""Sample one MFA press briefing page to understand structure."""
import requests, re, sys
from bs4 import BeautifulSoup

HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"}
S = requests.Session(); S.headers.update(HDR)

URL = "https://www.fmprc.gov.cn/eng/xw/fyrbt/lxjzh/202607/t20260728_11993800.html"
r = S.get(URL, timeout=15)
r.encoding = "utf-8"
print(f"status={r.status_code}  bytes={len(r.text)}")
soup = BeautifulSoup(r.text, "lxml")
print(f"title: {soup.title.get_text(strip=True)[:120]}")

# Try common content containers
for sel in ["#Content", ".TRS_Editor", ".content", ".content_body", ".article", "article", "#zoom"]:
    el = soup.select_one(sel)
    if el:
        print(f"\n=== selector {sel!r} matched ===")
        print(f"  chars: {len(el.get_text())}")
        break

# Fall back to counting <p>
paras = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
paras = [p for p in paras if len(p) > 20]
print(f"\n<p>#{len(paras)}, first 6 paragraphs:")
for i, p in enumerate(paras[:8]):
    print(f"  [{i}] {p[:200]}")
print(f"\nlast 4 paragraphs:")
for i, p in enumerate(paras[-4:]):
    print(f"  [{i}] {p[:200]}")

# Try to find the Chinese pair page - MFA usually mirrors CN/EN
# CN URL pattern: /web/wjdt_674879/fyrbt_674889/YYYYMM/tYYYYMMDD_XXXXX.shtml
en_id = re.search(r"t(\d{8})_(\d+)", URL).group(0)
print(f"\nID token from URL: {en_id}")
