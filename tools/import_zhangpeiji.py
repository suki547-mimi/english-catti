"""Extract readable bilingual sentences from张培基 Anki deck.

Focus on model 1639928733995 (张培基英译解析): 2220 notes with
  field[0] = Chinese original
  field[1] = English translation (张培基)
"""
import json, re, html, os, hashlib

SRC = r'C:\Cursorworkspace\English\data\external\zhangpeiji_anki.json'
OUT_ZP  = r'C:\Cursorworkspace\English\data\zhangpeiji_pairs.json'
OUT_EN  = r'C:\Cursorworkspace\English\data\zhangpeiji_en_snippets.json'

def strip_html(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r'\[sound:[^\]]+\]', '', text)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
    text = re.sub(r'</p>', '\n', text, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'&nbsp;', ' ', text)
    return re.sub(r'[ \t]+', ' ', text).strip()

notes = json.load(open(SRC, 'r', encoding='utf-8'))

# --- Model 张培基英译解析: bilingual sentence pairs ---
zp_pairs = []
for n in notes:
    if n['mid'] != 1639928733995:
        continue
    fs = [strip_html(f) for f in n['fields']]
    zh, en = fs[0], fs[1]
    if not zh or not en: continue
    # Skip if zh is not mostly Chinese, or en is not mostly Latin
    zh_chars = sum(1 for c in zh if '\u4e00' <= c <= '\u9fff')
    en_chars = sum(1 for c in en if c.isascii() and c.isalpha())
    if zh_chars < 3 or en_chars < 5: continue
    key = hashlib.sha1(f"{zh}|||{en}".encode('utf-8')).hexdigest()[:16]
    zp_pairs.append({
        "id": key,
        "zh": zh,
        "en": en,
        "source": "zhangpeiji-anki",
        "note_id": n['id'],
    })

# --- Model 基础的 (英文单句) ---
en_snippets = []
for n in notes:
    if n['mid'] != 1619368562021:
        continue
    fs = [strip_html(f) for f in n['fields']]
    en = fs[0]
    if not en: continue
    en_chars = sum(1 for c in en if c.isascii() and c.isalpha())
    if en_chars < 3: continue
    en_snippets.append({
        "en": en,
        "source": "zhangpeiji-anki-basic",
        "note_id": n['id'],
    })

os.makedirs(os.path.dirname(OUT_ZP), exist_ok=True)
with open(OUT_ZP, 'w', encoding='utf-8') as f:
    json.dump(zp_pairs, f, ensure_ascii=False, indent=1)
with open(OUT_EN, 'w', encoding='utf-8') as f:
    json.dump(en_snippets, f, ensure_ascii=False, indent=1)

print(f"张培基 sentence pairs: {len(zp_pairs)}")
print(f"英文短句 snippets:    {len(en_snippets)}")

# Sample
print('\n--- 3 张培基 samples ---')
for p in zp_pairs[:3]:
    print(f'\n ZH: {p["zh"][:150]}')
    print(f' EN: {p["en"][:150]}')

print('\n--- 3 英文 snippets ---')
for s in en_snippets[:3]:
    print(f'  {s["en"][:150]}')
