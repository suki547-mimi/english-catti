"""Probe 3 candidate sources for the B plan. Print structural findings."""
from __future__ import annotations
import time, re, sys
import requests
from bs4 import BeautifulSoup

HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Connection": "keep-alive",
}
S = requests.Session(); S.headers.update(HDR)

def probe(name, url, must_find=(), maxbytes=1200):
    print(f"\n{'='*70}\n[{name}] GET {url}")
    try:
        t0 = time.time()
        r = S.get(url, timeout=15)
        r.encoding = r.apparent_encoding or "utf-8"
        dt = time.time() - t0
        print(f"  status={r.status_code}  bytes={len(r.text)}  time={dt:.2f}s  encoding={r.encoding}")
        html = r.text
        for m in must_find:
            print(f"  contains {m!r}: {m in html}")
        # Show link stats
        try:
            soup = BeautifulSoup(html, "lxml")
            title = soup.title.get_text(strip=True) if soup.title else "-"
            print(f"  <title>: {title[:80]}")
            links = soup.find_all("a")
            print(f"  total <a>: {len(links)}")
            # Show a few sample article-like links
            samples = []
            for a in links:
                href = (a.get("href") or "").strip()
                text = a.get_text(" ", strip=True)
                if not href or href.startswith(("#", "javascript:", "mailto:")): continue
                if 6 < len(text) < 120 and any(k in href.lower() for k in ("article","content","node","html")):
                    samples.append((text[:60], href[:120]))
                if len(samples) >= 8: break
            for t, h in samples:
                print(f"    - {t}\n      -> {h}")
        except Exception as e:
            print(f"  parse err: {e}")
        return r
    except Exception as e:
        print(f"  !! {e}")
        return None

# 1. 外交部 English press briefings
probe("MFA-EN briefing index",
      "https://www.fmprc.gov.cn/eng/xw/zyxw/",
      must_find=("Foreign Ministry", "Spokesperson"))

# also try the fyrbt page (both langs)
probe("MFA-EN fyrbt",
      "https://www.fmprc.gov.cn/eng/xw/fyrbt/",
      must_find=("Regular Press", "Spokesperson"))

# 2. Hjenglish Economist section
probe("Hjenglish Economist",
      "https://www.hjenglish.com/newsteneijingxueren/",
      must_find=("经济学人",))

# 3. 可可英语 Economist
probe("Kekenet Economist",
      "https://www.kekenet.com/Economist/",
      must_find=("经济学人","Economist"))

# 4. 张培基 - search a plausible page
probe("Zhang Peiji search on baike",
      "https://baike.baidu.com/item/%E5%BC%A0%E5%9F%B9%E5%9F%BA",
      must_find=("张培基",))
