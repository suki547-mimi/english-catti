"""Dry-run MFA scraper: fetch 2 briefings, verify Q&A extraction."""
import sys
sys.path.insert(0, r'C:\Cursorworkspace\English\tools')
import scrape_mfa as m

# Fetch one specific EN + CN pair to verify parsing
EN_URL = "https://www.fmprc.gov.cn/eng/xw/fyrbt/lxjzh/202607/t20260728_11993800.html"
CN_URL = "https://www.fmprc.gov.cn/web/wjdt_674879/fyrbt_674889/202607/t20260728_11993669.shtml"

print("=== EN ===")
r = m.http_get(EN_URL)
en_paras = m._extract_paragraphs(r.text)
print(f"paras: {len(en_paras)}")
for i, p in enumerate(en_paras[:5]):
    print(f"  [{i}] {p[:150]}")
en_pairs = m._extract_qa_pairs_en(en_paras)
print(f"\nEN pairs: {len(en_pairs)}")
for k, p in enumerate(en_pairs[:3]):
    print(f"\n  Q{k} [{p['questioner']}]: {p['question'][:120]}")
    print(f"  A{k} [{p['spokesperson']}]: {p['answer'][:120]}")

print("\n=== CN ===")
r = m.http_get(CN_URL)
if r:
    cn_paras = m._extract_paragraphs(r.text)
    print(f"paras: {len(cn_paras)}")
    for i, p in enumerate(cn_paras[:5]):
        print(f"  [{i}] {p[:150]}")
    cn_pairs = m._extract_qa_pairs_cn(cn_paras)
    print(f"\nCN pairs: {len(cn_pairs)}")
    for k, p in enumerate(cn_pairs[:3]):
        print(f"\n  Q{k} [{p['questioner']}]: {p['question'][:150]}")
        print(f"  A{k} [{p['spokesperson']}]: {p['answer'][:150]}")
    print(f"\n>>> aligned: EN {len(en_pairs)} vs CN {len(cn_pairs)}")
else:
    print("CN fetch failed")
