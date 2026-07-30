"""Fetch IPA phonetics for single-word vocab entries from Free Dictionary API.

Output: data/phonetics.json
  { "<word_lower>": {"ipa": "...", "us": "...", "uk": "...", "raw": [...]} }

Free Dictionary API (dictionaryapi.dev) — unauthenticated, generous rate limits.
Skips multi-word entries and non-alphabetic entries.
Resume-safe: skips words already in output.
"""
from __future__ import annotations
import json, os, re, sys, time, threading, queue
import requests

ROOT = r'C:\Cursorworkspace\English'
VOCAB = os.path.join(ROOT, 'data', 'unified_vocab.json')
OUT = os.path.join(ROOT, 'data', 'phonetics.json')
LOG = os.path.join(ROOT, 'data', 'phonetics.log')

API = "https://api.dictionaryapi.dev/api/v2/entries/en/{}"
HDR = {"User-Agent": "Mozilla/5.0"}
CONCURRENCY = 4
SLEEP_PER_REQ = 0.05
SAVE_EVERY = 100

session = requests.Session(); session.headers.update(HDR)

def load_existing() -> dict:
    if os.path.exists(OUT):
        try:
            return json.load(open(OUT, 'r', encoding='utf-8'))
        except Exception:
            pass
    return {}

def log(msg: str):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")

def fetch_one(word: str) -> dict | None:
    try:
        r = session.get(API.format(word), timeout=10)
        if r.status_code == 404:
            return {"ipa": "", "us": "", "uk": "", "notfound": True}
        if r.status_code != 200:
            return None
        data = r.json()
        if not isinstance(data, list) or not data:
            return None
        us_audio = uk_audio = None
        us_ipa = uk_ipa = None
        generic_ipa = None
        raw = []
        for entry in data:
            for p in entry.get('phonetics', []):
                text = (p.get('text') or '').strip()
                audio = (p.get('audio') or '').strip()
                if audio:
                    if 'us.mp3' in audio or '-us-' in audio:
                        us_ipa = us_ipa or text
                        us_audio = audio
                    elif 'uk.mp3' in audio or '-uk-' in audio:
                        uk_ipa = uk_ipa or text
                        uk_audio = audio
                elif text:
                    generic_ipa = generic_ipa or text
                if text or audio:
                    raw.append({'text': text, 'audio': audio})
        return {
            "ipa": generic_ipa or us_ipa or uk_ipa or "",
            "us": us_ipa or generic_ipa or "",
            "uk": uk_ipa or generic_ipa or "",
            "us_audio": us_audio or "",
            "uk_audio": uk_audio or "",
            "raw": raw[:6],
        }
    except Exception as e:
        return None

def worker(q: queue.Queue, out_dict: dict, lock: threading.Lock, stats: dict):
    while True:
        word = q.get()
        if word is None:
            q.task_done(); break
        res = fetch_one(word)
        with lock:
            if res is not None:
                out_dict[word] = res
                stats['ok'] += 1
                if res.get('notfound'):
                    stats['notfound'] += 1
            else:
                stats['fail'] += 1
            stats['done'] += 1
            if stats['done'] % SAVE_EVERY == 0:
                with open(OUT, 'w', encoding='utf-8') as f:
                    json.dump(out_dict, f, ensure_ascii=False, indent=1)
                elapsed = time.time() - stats['t0']
                eta = elapsed / stats['done'] * (stats['total'] - stats['done'])
                print(f"  [{stats['done']}/{stats['total']}]  ok={stats['ok']} notfound={stats['notfound']} fail={stats['fail']}  ETA {eta:.0f}s")
        time.sleep(SLEEP_PER_REQ)
        q.task_done()

def main():
    vocab = json.load(open(VOCAB, 'r', encoding='utf-8'))
    # Extract unique single-word English (lowercase) that likely have dict entries
    words = set()
    for v in vocab:
        en = (v.get('en') or '').strip()
        if not en: continue
        tokens = en.split()
        if len(tokens) != 1: continue
        w = tokens[0].lower()
        if not re.fullmatch(r"[a-z][a-z\-']{1,30}", w): continue
        words.add(w)
    words = sorted(words)
    print(f"Unique single-word ENs: {len(words)}")

    existing = load_existing()
    todo = [w for w in words if w not in existing]
    print(f"Already have: {len(existing)}   To fetch: {len(todo)}")

    if not todo:
        print("Nothing to do.")
        return

    q = queue.Queue()
    lock = threading.Lock()
    stats = {'total': len(todo), 'done': 0, 'ok': 0, 'notfound': 0, 'fail': 0, 't0': time.time()}
    threads = [threading.Thread(target=worker, args=(q, existing, lock, stats), daemon=True) for _ in range(CONCURRENCY)]
    for t in threads: t.start()
    for w in todo: q.put(w)
    for _ in range(CONCURRENCY): q.put(None)
    q.join()

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(existing, f, ensure_ascii=False, indent=1)
    elapsed = time.time() - stats['t0']
    print(f"\n[done] {stats['done']} fetched in {elapsed:.0f}s   ok={stats['ok']}  notfound={stats['notfound']}  fail={stats['fail']}")
    print(f"  -> {OUT}")

if __name__ == '__main__':
    main()
