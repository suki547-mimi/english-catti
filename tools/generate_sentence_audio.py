"""Generate audio for corpus sentences (unified_sentences.json).

For each sentence pair we generate 3 mp3s:
  - en/us/<hash>.mp3  (en-US-AriaNeural)
  - en/uk/<hash>.mp3  (en-GB-SoniaNeural)
  - zh/<hash>.mp3     (zh-CN-XiaoxiaoNeural)

Index at data/sentence_audio_index.json:
  {"<sentence_id>": {"us":"...","uk":"...","zh":"..."}}

Resume-safe: skips existing files.
"""
from __future__ import annotations
import asyncio, hashlib, json, os, time
import edge_tts

ROOT = r'C:\Cursorworkspace\English'
SENTENCES = os.path.join(ROOT, 'data', 'unified_sentences.json')
AUDIO_ROOT = os.path.join(ROOT, 'data', 'audio', 'sentences')
INDEX_PATH = os.path.join(ROOT, 'data', 'sentence_audio_index.json')
LOG_PATH = os.path.join(ROOT, 'data', 'sentence_audio.log')

VOICE_US = 'en-US-AriaNeural'
VOICE_UK = 'en-GB-SoniaNeural'
VOICE_ZH = 'zh-CN-XiaoxiaoNeural'
CONCURRENCY = 4
RETRIES = 3
MAX_CHARS = 400   # skip overly long sentences

def slugify(text: str) -> str:
    return hashlib.sha1(text.strip().lower().encode('utf-8')).hexdigest()[:16]

def should_skip(text: str) -> bool:
    return not text or not text.strip() or len(text) > MAX_CHARS

def log(msg: str):
    with open(LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")

async def synth(text: str, voice: str, path: str) -> tuple[bool, str]:
    for i in range(RETRIES):
        try:
            com = edge_tts.Communicate(text, voice)
            await com.save(path)
            if os.path.exists(path) and os.path.getsize(path) > 500:
                return True, ''
            if os.path.exists(path): os.remove(path)
        except Exception as e:
            err = f'{type(e).__name__}: {e}'
            await asyncio.sleep(0.5 * (i + 1))
            if i == RETRIES - 1:
                return False, err
    return False, 'exhausted'

async def worker(name: str, q: asyncio.Queue, stats: dict):
    while True:
        job = await q.get()
        if job is None:
            q.task_done(); break
        text, voice, path = job
        ok, err = await synth(text, voice, path)
        if ok: stats['ok'] += 1
        else:
            stats['fail'] += 1
            log(f'FAIL {voice} {text[:60]!r} -> {err}')
        stats['done'] += 1
        if stats['done'] % 100 == 0:
            elapsed = time.time() - stats['t0']
            eta = elapsed / stats['done'] * (stats['total'] - stats['done'])
            print(f"  [{stats['done']}/{stats['total']}] ok={stats['ok']} fail={stats['fail']} elapsed={elapsed:.0f}s eta={eta:.0f}s")
        q.task_done()

async def main():
    print(f"[1/4] Load sentences")
    sentences = json.load(open(SENTENCES, 'r', encoding='utf-8'))
    print(f"  {len(sentences)} sentence pairs")

    print(f"[2/4] Build audio index + job list")
    os.makedirs(os.path.join(AUDIO_ROOT, 'en', 'us'), exist_ok=True)
    os.makedirs(os.path.join(AUDIO_ROOT, 'en', 'uk'), exist_ok=True)
    os.makedirs(os.path.join(AUDIO_ROOT, 'zh'), exist_ok=True)

    index = {}
    jobs = []
    for s in sentences:
        sid = s.get('id') or slugify((s.get('en') or '') + '|' + (s.get('zh') or ''))
        en = (s.get('en') or '').strip()
        zh = (s.get('zh') or '').strip()
        if should_skip(en) and should_skip(zh):
            continue
        entry = {}
        if not should_skip(en):
            h = slugify(en)
            us_path = os.path.join(AUDIO_ROOT, 'en', 'us', f'{h}.mp3')
            uk_path = os.path.join(AUDIO_ROOT, 'en', 'uk', f'{h}.mp3')
            entry['us'] = f'audio/sentences/en/us/{h}.mp3'
            entry['uk'] = f'audio/sentences/en/uk/{h}.mp3'
            if not (os.path.exists(us_path) and os.path.getsize(us_path) > 500):
                jobs.append((en, VOICE_US, us_path))
            if not (os.path.exists(uk_path) and os.path.getsize(uk_path) > 500):
                jobs.append((en, VOICE_UK, uk_path))
        if not should_skip(zh):
            hz = slugify(zh)
            zh_path = os.path.join(AUDIO_ROOT, 'zh', f'{hz}.mp3')
            entry['zh'] = f'audio/sentences/zh/{hz}.mp3'
            if not (os.path.exists(zh_path) and os.path.getsize(zh_path) > 500):
                jobs.append((zh, VOICE_ZH, zh_path))
        if entry:
            index[sid] = entry

    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"  index: {len(index)} sentences  jobs queued: {len(jobs)}")

    if not jobs:
        print("[done] all up to date")
        return

    print(f"[3/4] Synthesize (concurrency={CONCURRENCY})")
    stats = {'total': len(jobs), 'done': 0, 'ok': 0, 'fail': 0, 't0': time.time()}
    q: asyncio.Queue = asyncio.Queue(maxsize=CONCURRENCY * 4)
    workers = [asyncio.create_task(worker(f'w{i}', q, stats)) for i in range(CONCURRENCY)]
    for j in jobs: await q.put(j)
    for _ in range(CONCURRENCY): await q.put(None)
    await q.join()
    await asyncio.gather(*workers, return_exceptions=True)

    print(f"\n[4/4] Done")
    elapsed = time.time() - stats['t0']
    print(f"  jobs: {stats['done']}  ok={stats['ok']}  fail={stats['fail']}  in {elapsed/60:.1f} min")

if __name__ == '__main__':
    asyncio.run(main())
