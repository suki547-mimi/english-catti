"""Download a public high-frequency English word list and add to unified vocab.

Sources tried (in order):
  1. first20hours/google-10000-english  (Google 10K most common English words)
  2. Fallback: SUBTLEX-us or similar

Adds NEW headwords not already in unified_vocab.json as bare skeleton entries:
  {en: <lemma>, zh: '', kind: 'word', source: 'google-10k', frequency_rank: N}
"""
import os, re, json, hashlib
import requests

ROOT = r'C:\Cursorworkspace\English\data'
UNIFIED_V = os.path.join(ROOT, 'unified_vocab.json')
EXT_DIR = os.path.join(ROOT, 'external')
os.makedirs(EXT_DIR, exist_ok=True)

# Google 10k — plain text, one word per line, ordered by frequency
G10K_URL = "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt"
G10K_NO_SWEARS = "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt"

STOP_HEAD = {"a","an","the","to","of","in","on","for","with","by","at",
             "and","or","not","no","as","be","is","are","was","were"}

def headword_of(en: str) -> str:
    toks = re.findall(r"[A-Za-z][A-Za-z\-']+", en)
    for t in toks:
        if t.lower() not in STOP_HEAD:
            return t.lower()
    return toks[0].lower() if toks else ""

def dedup_key(zh: str, en: str) -> str:
    def norm_zh(s):
        s = re.sub(r'[（(].*?[)）]', '', s)
        s = re.sub(r'\s+', '', s)
        return s.strip('，。、；：？！,.;:?!').lower()
    return f"{headword_of(en)}|||{norm_zh(zh)}"

# --- 1. Download Google 10k ---
print("[1] Download Google 10k word list...")
r = requests.get(G10K_URL, timeout=30)
r.raise_for_status()
words = [w.strip() for w in r.text.splitlines() if w.strip()]
with open(os.path.join(EXT_DIR, 'google-10000-english-usa.txt'), 'w', encoding='utf-8') as f:
    f.write(r.text)
print(f"  got {len(words)} words. First 15: {words[:15]}")

# --- 2. Load unified vocab, collect existing headwords ---
print("\n[2] Load unified vocab...")
vocab = json.load(open(UNIFIED_V, 'r', encoding='utf-8'))
existing_headwords = {v['headword'].lower() for v in vocab if v.get('headword')}
existing_en = {v['en'].strip().lower() for v in vocab}
print(f"  existing entries: {len(vocab)}")
print(f"  existing unique headwords: {len(existing_headwords)}")

# --- 3. Add NEW lemmas not already covered ---
print("\n[3] Add missing lemmas from Google 10k...")
added = 0
for rank, w in enumerate(words, 1):
    w = w.strip().lower()
    if not w or not w.isalpha(): continue
    if len(w) < 2: continue
    if w in STOP_HEAD: continue          # skip most trivial function words
    if w in existing_headwords: continue
    if w in existing_en: continue
    hw = headword_of(w)
    key = dedup_key('', w)
    entry = {
        "id": hashlib.sha1(key.encode('utf-8')).hexdigest()[:16],
        "zh": "",                        # to be filled by LLM/manual later
        "en": w,
        "headword": hw,
        "letter": hw[:1].upper() if hw else '#',
        "topic": "coca-backbone",
        "sources": ["google-10k"],
        "kind": "word",
        "phonetic": "",
        "freq_rank": rank,
    }
    vocab.append(entry)
    existing_headwords.add(hw)
    added += 1

print(f"  added {added} new lemma entries")
print(f"  new total: {len(vocab)} entries")

# --- 4. Resort and save ---
vocab.sort(key=lambda e: (e.get('letter','#'), e.get('headword',''), e.get('en','')))

with open(UNIFIED_V, 'w', encoding='utf-8') as f:
    json.dump(vocab, f, ensure_ascii=False, indent=1)

# Stats
unique_hw = set(v['headword'] for v in vocab if v.get('headword'))
by_source = {}
for v in vocab:
    for s in v.get('sources', []):
        by_source[s] = by_source.get(s, 0) + 1
print(f"\n[done]")
print(f"  total entries: {len(vocab)}")
print(f"  unique headwords: {len(unique_hw)}")
print(f"  by source: {by_source}")
