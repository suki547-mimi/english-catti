"""Merge all vocab sources into unified_vocab.json + unified_sentences.json.

Sources (in priority order — earlier wins on conflict):
  1. catti3_vocab.json          (CATTI 3 骨架，含话题分类)
  2. vocab.json                 (本地 6038 分类词汇)
  3. chinadaily_vocab.json      (ChinaDaily 580 时政)

Dedup key = (headword_lower, zh_normalized)
On conflict: keep first-seen (higher priority), merge `sources[]`.

Sentence sources merged into unified_sentences.json (dedup by hash).
"""
from __future__ import annotations
import os, re, json, hashlib
from typing import List, Dict, Set

ROOT   = r'C:\Cursorworkspace\English\data'
UNIFIED_V = os.path.join(ROOT, 'unified_vocab.json')
UNIFIED_S = os.path.join(ROOT, 'unified_sentences.json')
REPORT    = os.path.join(ROOT, 'unified_report.json')

STOP_HEAD = {"a","an","the","to","of","in","on","for","with","by","at",
             "and","or","not","no","as","be","is","are","was","were"}

def norm_zh(s: str) -> str:
    s = re.sub(r'[（(].*?[)）]', '', s)   # drop parenthetical annotations
    s = re.sub(r'\s+', '', s)
    return s.strip('，。、；：？！,.;:?!').lower()

def headword_of(en: str) -> str:
    toks = re.findall(r"[A-Za-z][A-Za-z\-']+", en)
    for t in toks:
        if t.lower() not in STOP_HEAD:
            return t.lower()
    return toks[0].lower() if toks else ""

def norm_en(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip().lower()

def load_vocab(path: str) -> List[Dict]:
    return json.load(open(path, 'r', encoding='utf-8'))

def dedup_key(zh: str, en: str) -> str:
    return f"{headword_of(en)}|||{norm_zh(zh)}"

# --- 1. Merge vocab ---
sources_config = [
    ('catti3-syllabus-5000', 'catti3_vocab.json'),
    ('local-classified',     'vocab.json'),
    ('chinadaily-daily-word','chinadaily_vocab.json'),
]

unified: Dict[str, Dict] = {}
per_source_stats = {}
for src_tag, filename in sources_config:
    fp = os.path.join(ROOT, filename)
    if not os.path.exists(fp):
        print(f"[skip] {filename} not found")
        continue
    items = load_vocab(fp)
    added, merged = 0, 0
    for it in items:
        zh = it.get('zh', '').strip()
        en = it.get('en', '').strip()
        if not zh or not en: continue
        key = dedup_key(zh, en)
        if key in unified:
            # merge sources[]
            existing = unified[key]
            for s in it.get('sources', [src_tag]):
                if s not in existing['sources']:
                    existing['sources'].append(s)
            if src_tag not in existing['sources']:
                existing['sources'].append(src_tag)
            merged += 1
        else:
            hw = headword_of(en)
            unified[key] = {
                "id": hashlib.sha1(key.encode('utf-8')).hexdigest()[:16],
                "zh": zh,
                "en": en,
                "headword": hw,
                "letter": hw[:1].upper() if hw else '#',
                "topic": it.get('topic') or 'misc',
                "sources": list(it.get('sources', [src_tag])),
                "kind": it.get('kind', 'phrase'),
                "phonetic": it.get('phonetic', ''),
            }
            if src_tag not in unified[key]['sources']:
                unified[key]['sources'].append(src_tag)
            added += 1
    per_source_stats[src_tag] = {
        "input": len(items),
        "added": added,
        "merged_dupe": merged,
    }
    print(f"  {src_tag:35}  input={len(items):5}  added={added:5}  merged_dupe={merged:5}")

vocab_list = sorted(unified.values(), key=lambda e: (e['letter'], e['headword'], e['en']))

# --- 2. Distribution stats ---
letter_counts = {}
topic_counts = {}
kind_counts = {}
unique_headwords = set()
for e in vocab_list:
    letter_counts[e['letter']] = letter_counts.get(e['letter'], 0) + 1
    topic_counts[e['topic']] = topic_counts.get(e['topic'], 0) + 1
    kind_counts[e['kind']] = kind_counts.get(e['kind'], 0) + 1
    if e['headword']: unique_headwords.add(e['headword'])

# --- 3. Merge sentences ---
sentence_sources = [
    ('white-paper-peacekeeping',  'corpus_sentences.json'),
    ('chinadaily-daily-word',     'chinadaily_sentences.json'),
    ('zhangpeiji-anki',           'zhangpeiji_pairs.json'),
]
# Note: MFA is Q&A dialog format, kept separate
sent_by_id: Dict[str, Dict] = {}
sent_per_source = {}
for src_tag, filename in sentence_sources:
    fp = os.path.join(ROOT, filename)
    if not os.path.exists(fp): continue
    items = json.load(open(fp, 'r', encoding='utf-8'))
    added = 0
    for it in items:
        zh = it.get('zh', '').strip()
        en = it.get('en', '').strip()
        if not zh or not en: continue
        key = hashlib.sha1(f"{norm_zh(zh)}|||{norm_en(en)}".encode('utf-8')).hexdigest()[:16]
        if key in sent_by_id:
            existing = sent_by_id[key]
            if src_tag not in existing.get('sources', []):
                existing.setdefault('sources', [existing.get('source', 'unknown')]).append(src_tag)
            continue
        sent_by_id[key] = {
            "id": key,
            "zh": zh,
            "en": en,
            "source": it.get('source', src_tag),
            "sources": [src_tag],
            "url": it.get('url'),
            "date": it.get('date'),
            "kind": it.get('kind', 'para'),
        }
        added += 1
    sent_per_source[src_tag] = {"input": len(items), "added": added}
    print(f"  sentences {src_tag:35}  input={len(items):5}  added={added:5}")

sentence_list = list(sent_by_id.values())

# --- 4. Write outputs ---
with open(UNIFIED_V, 'w', encoding='utf-8') as f:
    json.dump(vocab_list, f, ensure_ascii=False, indent=1)
with open(UNIFIED_S, 'w', encoding='utf-8') as f:
    json.dump(sentence_list, f, ensure_ascii=False, indent=1)

report = {
    "vocab_total": len(vocab_list),
    "unique_headwords": len(unique_headwords),
    "sentences_total": len(sentence_list),
    "per_source_vocab": per_source_stats,
    "per_source_sentences": sent_per_source,
    "by_letter": dict(sorted(letter_counts.items())),
    "by_topic": dict(sorted(topic_counts.items(), key=lambda x: -x[1])),
    "by_kind": dict(sorted(kind_counts.items())),
}
with open(REPORT, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print()
print(f"[done]")
print(f"  vocab entries:       {len(vocab_list)}")
print(f"  unique headwords:    {len(unique_headwords)}")
print(f"  bilingual sentences: {len(sentence_list)}")
print(f"  by kind:             {kind_counts}")
print(f"  outputs -> unified_vocab.json / unified_sentences.json / unified_report.json")
