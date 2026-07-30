"""Generate audio files for every unique English text in unified_vocab.json.

Layout:
  data/audio/us/<hash>.mp3   — en-US-AriaNeural
  data/audio/uk/<hash>.mp3   — en-GB-SoniaNeural
  data/audio_index.json       — { en_text: hash } lookup

Strategy:
  - Deduplicate by lowercased en text (many entries share same English side).
  - Skip entries where en is > 60 chars OR > 8 words (likely sentence, not term).
  - Skip if audio file already exists (resume-safe).
  - Concurrency: 6 parallel edge-tts connections (safe, tested).
  - Retry on transient failures 3x.
"""
from __future__ import annotations
import asyncio, hashlib, json, os, re, sys, time
from typing import List, Dict, Tuple

ROOT = r'C:\Cursorworkspace\English'
VOCAB = os.path.join(ROOT, 'data', 'unified_vocab.json')
AUDIO_DIR = os.path.join(ROOT, 'data', 'audio')
INDEX_PATH = os.path.join(ROOT, 'data', 'audio_index.json')
LOG_PATH = os.path.join(ROOT, 'data', 'audio_gen.log')

VOICE_US = 'en-US-AriaNeural'
VOICE_UK = 'en-GB-SoniaNeural'
CONCURRENCY = 6
RETRIES = 3
MAX_WORDS = 8
MAX_CHARS = 80

def slugify_hash(text: str) -> str:
    return hashlib.sha1(text.lower().encode('utf-8')).hexdigest()[:16]

def should_include(en: str) -> bool:
    en = en.strip()
    if not en: return False
    if len(en) > MAX_CHARS: return False
    if len(en.split()) > MAX_WORDS: return False
    # Skip entries that are pure numbers, symbols, or non-latin
    if not re.search(r'[A-Za-z]', en): return False
    return True

def log(msg: str):
    with open(LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")

async def synth_one(text: str, voice: str, path: str) -> Tuple[bool, str]:
    """Return (success, error_msg)."""
    import edge_tts
    for attempt in range(RETRIES):
        try:
            com = edge_tts.Communicate(text, voice)
            await com.save(path)
            if os.path.exists(path) and os.path.getsize(path) > 500:
                return True, ""
            else:
                if os.path.exists(path): os.remove(path)
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
            await asyncio.sleep(0.5 * (attempt + 1))
            if attempt == RETRIES - 1:
                return False, err
    return False, "exhausted retries"

async def worker(name: str, queue: asyncio.Queue, stats: Dict):
    while True:
        job = await queue.get()
        if job is None:
            queue.task_done(); break
        text, voice, path = job
        ok, err = await synth_one(text, voice, path)
        if ok:
            stats['success'] += 1
        else:
            stats['fail'] += 1
            log(f"FAIL {voice} {text[:60]!r} -> {err}")
        stats['done'] += 1
        if stats['done'] % 200 == 0:
            elapsed = time.time() - stats['t0']
            eta = elapsed / stats['done'] * (stats['total'] - stats['done'])
            print(f"  [{stats['done']}/{stats['total']}] success={stats['success']} fail={stats['fail']} elapsed={elapsed:.0f}s eta={eta:.0f}s")
        queue.task_done()

async def main():
    print(f"[1/4] Load vocab from {VOCAB}")
    vocab = json.load(open(VOCAB, 'r', encoding='utf-8'))
    print(f"  {len(vocab)} entries")

    # Dedupe by en text
    unique_en: Dict[str, str] = {}   # en_text -> hash
    for v in vocab:
        en = (v.get('en') or '').strip()
        if not should_include(en): continue
        h = slugify_hash(en)
        unique_en.setdefault(en, h)
    print(f"  unique English texts to synthesize: {len(unique_en)}")

    # Save index (mapping for later lookup)
    print(f"[2/4] Write audio index")
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(os.path.join(AUDIO_DIR, 'us'), exist_ok=True)
    os.makedirs(os.path.join(AUDIO_DIR, 'uk'), exist_ok=True)
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump({en: {"hash": h, "us": f"audio/us/{h}.mp3", "uk": f"audio/uk/{h}.mp3"}
                   for en, h in unique_en.items()}, f, ensure_ascii=False, indent=1)

    print(f"[3/4] Build job queue (skip existing files)")
    jobs: List[Tuple[str, str, str]] = []
    for en, h in unique_en.items():
        us_path = os.path.join(AUDIO_DIR, 'us', f'{h}.mp3')
        uk_path = os.path.join(AUDIO_DIR, 'uk', f'{h}.mp3')
        if not os.path.exists(us_path) or os.path.getsize(us_path) < 500:
            jobs.append((en, VOICE_US, us_path))
        if not os.path.exists(uk_path) or os.path.getsize(uk_path) < 500:
            jobs.append((en, VOICE_UK, uk_path))
    print(f"  jobs queued: {len(jobs)}")

    if not jobs:
        print("[done] nothing to do — all files already exist.")
        return

    print(f"[4/4] Synthesize with concurrency={CONCURRENCY}")
    stats = {'total': len(jobs), 'done': 0, 'success': 0, 'fail': 0, 't0': time.time()}
    queue: asyncio.Queue = asyncio.Queue(maxsize=CONCURRENCY * 4)
    workers = [asyncio.create_task(worker(f"w{i}", queue, stats))
               for i in range(CONCURRENCY)]
    for j in jobs:
        await queue.put(j)
    for _ in range(CONCURRENCY):
        await queue.put(None)
    await queue.join()
    await asyncio.gather(*workers, return_exceptions=True)

    elapsed = time.time() - stats['t0']
    print(f"\n[done]")
    print(f"  jobs done:  {stats['done']}")
    print(f"  success:    {stats['success']}")
    print(f"  fail:       {stats['fail']}")
    print(f"  elapsed:    {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"  audio dir:  {AUDIO_DIR}")

if __name__ == "__main__":
    asyncio.run(main())
