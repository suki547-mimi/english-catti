import json, re, sys
p = sys.argv[1]
d = json.load(open(p, 'r', encoding='utf-8'))
html = d.get('htmlContent') or d.get('content') or ''
print('html length:', len(html))
links = re.findall(r'href="([^"]+)"[^>]*>([^<]{2,120})</a>', html)
print(f'Total links: {len(links)}')
seen = set()
for h, t in links:
    if h in seen: continue
    seen.add(h)
    print(f'  {t.strip()[:80]} -> {h[:150]}')
print(f'\nunique: {len(seen)}')

