"""Inspect raw article HTML structure to fix section detection."""
import sys, re
sys.path.insert(0, r'C:\Cursorworkspace\English\tools')
import scrape_chinadaily as s

URL = "https://language.chinadaily.com.cn/a/202505/07/WS681b18fba310a04af22bdeef.html"
r = s.SESSION.get(URL, timeout=15)
r.encoding = "utf-8"
html = r.text
print(f"bytes: {len(html)}")

# Where does the 相关词汇 marker sit?
for m in re.finditer(r"相关词汇|【相关词汇】", html):
    start = max(0, m.start() - 40)
    end = min(len(html), m.end() + 400)
    print(f"\n@ pos {m.start()} match={m.group()}:")
    print(f"  {html[start:end]}")

# Show paragraph list
print("\n=== _paras_from_html output ===")
paras = s._paras_from_html(html)
print(f"Total paras: {len(paras)}")
for i, p in enumerate(paras):
    print(f" [{i:3d}] {p[:120]}")
