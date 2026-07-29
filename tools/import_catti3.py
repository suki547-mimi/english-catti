"""Convert CATTI3 5000 CSV to unified vocab.json schema and merge stats."""
import csv, json, hashlib, os, re

SRC = r'C:\Cursorworkspace\English\data\external\CATTI三级口译词汇5000.csv'
OUT = r'C:\Cursorworkspace\English\data\catti3_vocab.json'

STOP_HEAD = {"a","an","the","to","of","in","on","for","with","by","at",
             "and","or","not","no","as","be","is","are","was","were"}

def headword(en: str) -> str:
    toks = re.findall(r"[A-Za-z][A-Za-z\-']+", en)
    for t in toks:
        if t.lower() not in STOP_HEAD:
            return t.lower()
    return toks[0].lower() if toks else ""

def make_id(zh: str, en: str) -> str:
    return hashlib.sha1(f"{zh.lower()}|||{en.lower()}".encode("utf-8")).hexdigest()[:16]

entries = []
with open(SRC, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        en = (row.get('word') or '').strip()
        zh = (row.get('meaning') or '').strip()
        cat = (row.get('category') or '').strip()
        ph = (row.get('phonetic') or '').strip()
        if not en or not zh: continue
        hw = headword(en)
        entries.append({
            "id": make_id(zh, en),
            "zh": zh,
            "en": en,
            "headword": hw,
            "letter": hw[:1].upper() if hw else "#",
            "topic": cat or "misc",
            "sources": ["catti3-syllabus-5000"],
            "kind": "word" if (' ' not in en and len(en.split()) == 1) else "phrase",
            "phonetic": ph,
        })

# Sort by letter, headword
entries.sort(key=lambda e: (e["letter"], e["headword"], e["en"]))
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(entries, f, ensure_ascii=False, indent=1)

# Stats
by_letter = {}
by_topic = {}
by_kind = {}
for e in entries:
    by_letter[e['letter']] = by_letter.get(e['letter'], 0) + 1
    by_topic[e['topic']] = by_topic.get(e['topic'], 0) + 1
    by_kind[e['kind']] = by_kind.get(e['kind'], 0) + 1

print(f'Total: {len(entries)}')
print(f'Kinds: {by_kind}')
print(f'Letters:')
for k in sorted(by_letter): print(f'  {k}: {by_letter[k]}')
print(f'Topics:')
for k, v in sorted(by_topic.items(), key=lambda x: -x[1]):
    print(f'  {k}: {v}')
print(f'\nSample first 5:')
for e in entries[:5]:
    print(f'  [{e["letter"]}] {e["headword"]:<20} | {e["en"]:<30} -> {e["zh"]}  (topic={e["topic"]})')
