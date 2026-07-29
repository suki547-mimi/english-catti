"""Deep-dive: inspect CN paragraphs to understand structure."""
import sys, re
sys.path.insert(0, r'C:\Cursorworkspace\English\tools')
import scrape_mfa as m

CN_URL = "https://www.fmprc.gov.cn/web/wjdt_674879/fyrbt_674889/202607/t20260728_11993669.shtml"
r = m.http_get(CN_URL)
paras = m._extract_paragraphs(r.text)
print(f"total paragraphs: {len(paras)}")

# Print ALL paragraphs that look like Q or A (contain a colon early)
for i, p in enumerate(paras):
    # Find first colon (either variety)
    idx1 = p.find("：")
    idx2 = p.find(":")
    idx = min([x for x in [idx1, idx2] if x >= 0], default=-1)
    if 0 < idx < 30:
        prefix = p[:idx]
        rest = p[idx+1:]
        print(f"\n [{i}] prefix={prefix!r}  first-30={rest[:60]!r}")
