"""Dry-run: enumerate 2 pages of URLs, parse the newest 3 articles, dump structure."""
import json, sys, os
sys.path.insert(0, r'C:\Cursorworkspace\English\tools')
import scrape_chinadaily as s

urls = s.enumerate_urls((2024, 5, 1), max_pages=2)
print(f"\nCollected {len(urls)} URLs")
for u in urls[:5]:
    print(f"  {u['date']}  {u['url']}\n    hint: {u['title_hint'][:80]}")

print("\n--- Parsing 3 articles ---")
for meta in urls[:3]:
    r = s.SESSION.get(meta['url'], timeout=15)
    r.encoding = "utf-8"
    parsed = s.parse_article(r.text, meta)
    print(f"\n### {meta['date']}")
    print(f" title_pair : {parsed['title_pair']}")
    print(f" lead_pairs : {len(parsed['lead_pairs'])} pairs")
    for p in parsed['lead_pairs'][:2]:
        print(f"   ZH: {p[0][:70]}")
        print(f"   EN: {p[1][:70]}")
    print(f" speech_pairs: {len(parsed['speech_pairs'])}")
    for p in parsed['speech_pairs'][:2]:
        print(f"   ZH: {p[0][:70]}")
        print(f"   EN: {p[1][:70]}")
    print(f" related_pairs: {len(parsed['related_pairs'])}")
    for p in parsed['related_pairs']:
        print(f"   {p[0]} -> {p[1]}")
