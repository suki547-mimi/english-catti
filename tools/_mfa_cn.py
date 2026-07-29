"""Test if MFA has aligned Chinese briefing on same date."""
import requests, re
from bs4 import BeautifulSoup

HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"}
S = requests.Session(); S.headers.update(HDR)

# Try common Chinese MFA index pages
CN_CANDIDATES = [
    "https://www.fmprc.gov.cn/web/wjdt_674879/fyrbt_674889/",
    "https://www.fmprc.gov.cn/fyrbt_673021/",
    "https://www.mfa.gov.cn/web/wjdt_674879/fyrbt_674889/",
    "https://www.fmprc.gov.cn/wjbxw_new/",
]
for url in CN_CANDIDATES:
    try:
        r = S.get(url, timeout=12)
        r.encoding = "utf-8"
        print(f"[{r.status_code}] {url}  bytes={len(r.text)}")
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "lxml")
            print(f"  title: {soup.title.get_text(strip=True)[:80]}")
            links = []
            for a in soup.find_all("a"):
                h = (a.get("href") or "")
                t = a.get_text(" ", strip=True)
                if re.search(r"/2026\d{2}/t2026", h) and 4 < len(t) < 120:
                    links.append((t, h))
                if len(links) >= 8: break
            for t, h in links:
                print(f"    - {t[:70]}\n      -> {h[:120]}")
    except Exception as e:
        print(f"[ERR] {url}: {e}")
