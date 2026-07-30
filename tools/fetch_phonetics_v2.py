"""Fetch IPA from Wiktionary (primary) + Free Dict API leftovers + Youdao HTML.

Wiktionary supports huge vocabulary including political/CATTI terms.
For phrases, look up the longest content word.

Output: data/phonetics.json  (merged with existing entries — resume-safe)
  Schema per key: { "us": "...", "uk": "...", "ipa": "...", "source": "wiktionary|freedict|youdao" }
"""
from __future__ import annotations
import json, os, re, sys, time, threading, queue
import requests
from urllib.parse import quote

ROOT = r'C:\Cursorworkspace\English'
VOCAB = os.path.join(ROOT, 'data', 'unified_vocab.json')
OUT = os.path.join(ROOT, 'data', 'phonetics.json')

HDR = {
    "User-Agent": "english-catti-personal-study/1.0 (contact: suki547-mimi@github)",
    "Accept": "application/json",
}
CONCURRENCY = 6
SLEEP = 0.05
SAVE_EVERY = 100

STOP = {"a","an","the","to","of","in","on","for","with","by","at","and","or",
        "not","no","as","be","is","are","was","were","this","that","these",
        "those","from","into","upon","which","who","whom","what","when","where",
        "how","why","its","his","her","their","our","my","your","him","them"}

session = requests.Session(); session.headers.update(HDR)

# ---------------------------------------------------------------------------
# Wiktionary
# ---------------------------------------------------------------------------
WIKT_API = "https://en.wiktionary.org/w/api.php"

# {{IPA|en|/prɪˈɔːrətaɪz/}} or with region markers like {{a|GA}} {{IPA|en|/ˈkɑːbən/}}
RE_IPA_TMPL = re.compile(r'\{\{IPA\|(?:en\|)?(.*?)\}\}', re.DOTALL)
# {{a|US}}, {{a|UK}}, {{a|RP}}, {{a|GA}}, etc.
RE_ACCENT = re.compile(r'\{\{a\|([^}]+)\}\}')

def fetch_wikitext(word: str) -> str | None:
    try:
        r = session.get(WIKT_API, params={
            'action': 'parse', 'page': word, 'format': 'json',
            'prop': 'wikitext', 'redirects': 1,
        }, timeout=12)
        if r.status_code != 200: return None
        data = r.json()
        wt = data.get('parse', {}).get('wikitext', {}).get('*')
        return wt
    except Exception:
        return None

def parse_wiktionary_ipa(wikitext: str) -> dict:
    """Extract per-region IPAs from Wiktionary English section."""
    if not wikitext: return {}
    # Only consider the English language section
    m = re.search(r'==English==(.*?)(?===[A-Z][a-z]+==|\Z)', wikitext, flags=re.DOTALL)
    section = m.group(1) if m else wikitext
    result = {"us": "", "uk": "", "ipa": ""}
    # Scan Pronunciation area
    pron = re.search(r'===Pronunciation===(.*?)(?===[A-Z]|\Z)', section, flags=re.DOTALL)
    body = pron.group(1) if pron else section
    # Break into lines to associate {{a|...}} accent tag with following IPA on same line
    for line in body.splitlines():
        accents = [a.lower() for a in RE_ACCENT.findall(line)]
        for m2 in RE_IPA_TMPL.finditer(line):
            body_str = m2.group(1)
            # first / .. / group is the IPA
            ipa_match = re.search(r'(/[^/]+/)', body_str)
            if not ipa_match: continue
            ipa = ipa_match.group(1)
            is_us = any(a in ('us','ga','american','a-usa','general american','na','north america') for a in accents)
            is_uk = any(a in ('uk','rp','british','received pronunciation','england','en-uk') for a in accents)
            if is_us and not result["us"]: result["us"] = ipa
            if is_uk and not result["uk"]: result["uk"] = ipa
            if not result["ipa"]: result["ipa"] = ipa
    # Fallback if regions not tagged: use first IPA for both
    if result["ipa"] and not result["us"]: result["us"] = result["ipa"]
    if result["ipa"] and not result["uk"]: result["uk"] = result["ipa"]
    return result

# ---------------------------------------------------------------------------
# Youdao HTML fallback (only when Wiktionary fails)
# ---------------------------------------------------------------------------
def fetch_youdao(word: str) -> dict:
    try:
        r = session.get(f"https://dict.youdao.com/w/eng/{quote(word)}/", timeout=12,
                        headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code != 200: return {}
        html = r.text
        # Youdao HTML has <span class="phonetic">[美 /IPA/]</span> etc.
        us = re.search(r'美\s*</span>\s*<span[^>]*>\s*\[([^\]]+)\]', html)
        uk = re.search(r'英\s*</span>\s*<span[^>]*>\s*\[([^\]]+)\]', html)
        # Or newer layout
        if not us: us = re.search(r'美[^\[]*\[([^\]]+)\]', html)
        if not uk: uk = re.search(r'英[^\[]*\[([^\]]+)\]', html)
        result = {}
        if us: result['us'] = us.group(1).strip()
        if uk: result['uk'] = uk.group(1).strip()
        if result.get('us') or result.get('uk'):
            result['ipa'] = result.get('us') or result.get('uk')
        return result
    except Exception:
        return {}

# ---------------------------------------------------------------------------
# Word selection
# ---------------------------------------------------------------------------
def choose_lookup(en: str) -> str | None:
    en = en.strip()
    if not en: return None
    tokens = re.findall(r"[a-zA-Z][a-zA-Z\-']+", en)
    tokens = [t.lower() for t in tokens]
    if not tokens: return None
    if len(tokens) == 1: return tokens[0]
    # phrase: pick the longest non-stopword
    cand = [t for t in tokens if t not in STOP]
    if not cand: cand = tokens
    return max(cand, key=len)

def fetch_one(word: str) -> dict | None:
    # Youdao first — proven to have both US/UK IPA including CATTI-specific terms
    yd = fetch_youdao(word)
    if yd.get('ipa'):
        yd['source'] = 'youdao'
        return yd
    # Fallback: Wiktionary
    wt = fetch_wikitext(word)
    if wt:
        ipa = parse_wiktionary_ipa(wt)
        if ipa.get('ipa'):
            ipa['source'] = 'wiktionary'
            return ipa
    return {"us": "", "uk": "", "ipa": "", "source": "notfound"}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def load_existing() -> dict:
    if os.path.exists(OUT):
        try: return json.load(open(OUT, 'r', encoding='utf-8'))
        except Exception: pass
    return {}

def worker(q: queue.Queue, out: dict, lock: threading.Lock, stats: dict):
    while True:
        word = q.get()
        if word is None: q.task_done(); break
        # skip if we already have decent data (not just notfound)
        with lock:
            existing = out.get(word)
            if existing and existing.get('ipa') and existing.get('source') != 'notfound':
                stats['skip'] += 1; stats['done'] += 1; q.task_done(); continue
        r = fetch_one(word)
        with lock:
            if r is not None:
                out[word] = {
                    'ipa': r.get('ipa', ''), 'us': r.get('us', ''), 'uk': r.get('uk', ''),
                    'source': r.get('source', ''),
                }
                if r.get('ipa'): stats['ok'] += 1
                else: stats['notfound'] += 1
            else:
                stats['fail'] += 1
            stats['done'] += 1
            if stats['done'] % SAVE_EVERY == 0:
                with open(OUT, 'w', encoding='utf-8') as f:
                    json.dump(out, f, ensure_ascii=False, indent=1)
                elapsed = time.time() - stats['t0']
                eta = elapsed / stats['done'] * (stats['total'] - stats['done']) if stats['done'] else 0
                print(f"  [{stats['done']}/{stats['total']}] ok={stats['ok']} nf={stats['notfound']} fail={stats['fail']} skip={stats['skip']} ETA {eta:.0f}s")
        time.sleep(SLEEP)
        q.task_done()

def main():
    vocab = json.load(open(VOCAB, 'r', encoding='utf-8'))
    # Enumerate ALL content words from every vocab entry so phrases can be
    # rendered with per-word IPA in the UI.
    lookups = set()
    for v in vocab:
        en = (v.get('en') or '').strip()
        tokens = re.findall(r"[a-zA-Z][a-zA-Z\-']+", en)
        for t in tokens:
            t = t.lower()
            if t in STOP: continue
            if len(t) < 2: continue
            lookups.add(t)
    lookups = sorted(lookups)
    print(f"Unique content words: {len(lookups)}")

    existing = load_existing()
    print(f"Existing entries: {len(existing)}")

    q = queue.Queue()
    lock = threading.Lock()
    stats = {'total': len(lookups), 'done': 0, 'ok': 0, 'notfound': 0, 'fail': 0, 'skip': 0, 't0': time.time()}
    threads = [threading.Thread(target=worker, args=(q, existing, lock, stats), daemon=True) for _ in range(CONCURRENCY)]
    for t in threads: t.start()
    for w in lookups: q.put(w)
    for _ in range(CONCURRENCY): q.put(None)
    q.join()

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False, indent=1)
    elapsed = time.time() - stats['t0']
    print(f"\n[done] processed {stats['done']}  ok={stats['ok']}  notfound={stats['notfound']}  fail={stats['fail']}  skip={stats['skip']}")
    print(f"  elapsed: {elapsed:.0f}s")
    print(f"  -> {OUT}")

if __name__ == '__main__':
    main()
