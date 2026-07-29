import json, re, sys
p = sys.argv[1]
d = json.load(open(p, 'r', encoding='utf-8'))
h = d.get('htmlContent') or ''
# Match /USER/REPO links that look like real repos
seen = set()
for m in re.finditer(r'href="(/[^/"?#]+/[^/"?#]+)"[^>]*>', h):
    href = m.group(1)
    if href.count('/') != 2: continue
    if any(k in href.lower() for k in ('search','features','pricing','sponsors','marketplace','trending','topics','contact','skills','copilot','issues','pulls','stars','account','signup','login','discussions','sponsor','contribute','organizations','enterprise')): continue
    if href in seen: continue
    seen.add(href)
for u in sorted(seen):
    print(u)
