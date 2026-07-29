"""Download CATTI 3 vocab CSV + words.js from GitHub, and inspect."""
import requests, urllib.parse, os

OUT = r'C:\Cursorworkspace\English\data\external'
os.makedirs(OUT, exist_ok=True)

BASE = 'https://raw.githubusercontent.com/sherylling1986-beep/catti-vocabulary/main/'
for name in ['CATTI三级口译词汇5000.csv', 'words.js', 'README.md']:
    u = BASE + urllib.parse.quote(name)
    r = requests.get(u, timeout=15); r.raise_for_status()
    target = os.path.join(OUT, name)
    with open(target, 'wb') as f: f.write(r.content)
    print(f'saved {target}  ({len(r.content)} bytes)')

# Inspect CSV
csv_path = os.path.join(OUT, 'CATTI三级口译词汇5000.csv')
with open(csv_path, 'r', encoding='utf-8-sig') as f:
    text = f.read()
lines = text.splitlines()
print(f'\nCSV lines: {len(lines)}')
print('First 6 lines:')
for l in lines[:6]:
    print(f'  {l[:200]}')
print('Lines 100-105:')
for l in lines[100:105]:
    print(f'  {l[:200]}')

# Inspect words.js head
with open(os.path.join(OUT, 'words.js'), 'r', encoding='utf-8') as f:
    js_head = f.read(2500)
print('\nwords.js first 2500 chars:')
print(js_head)
