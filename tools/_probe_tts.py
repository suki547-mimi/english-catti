"""Probe pronunciation options."""
import requests, time, sys

HDR = {"User-Agent": "Mozilla/5.0"}
S = requests.Session(); S.headers.update(HDR)

TEST_WORDS = ["development", "hegemony", "geopolitical", "rejuvenation", "carbon-neutral"]

print("=== 1. Free Dictionary API (dictionaryapi.dev) ===")
for w in TEST_WORDS:
    try:
        r = S.get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{w}", timeout=10)
        if r.status_code == 200:
            data = r.json()
            phonetics = data[0].get('phonetics', [])
            audio_us, audio_uk, ipa = None, None, None
            for p in phonetics:
                url = p.get('audio', '')
                if not url: continue
                if 'us.mp3' in url or '-us-' in url:
                    audio_us = url
                if 'uk.mp3' in url or '-uk-' in url:
                    audio_uk = url
                if not ipa and p.get('text'):
                    ipa = p['text']
            print(f"  {w:20}  IPA={ipa or '-':15}  US={'YES' if audio_us else 'no':3}  UK={'YES' if audio_uk else 'no'}")
        else:
            print(f"  {w:20}  HTTP {r.status_code}")
    except Exception as e:
        print(f"  {w:20}  err: {e}")

print("\n=== 2. edge-tts (Microsoft Edge TTS via python) ===")
try:
    import edge_tts
    print(f"  edge_tts installed: version {edge_tts.__version__ if hasattr(edge_tts, '__version__') else 'unknown'}")
except ImportError:
    print("  NOT installed. Would need: pip install edge-tts")

print("\n=== 3. Merriam-Webster audio (public URL pattern) ===")
# MW audio has predictable URLs but requires knowing the audio filename
# Try their word-of-day page or dictionary API
r = S.get("https://media.merriam-webster.com/audio/prons/en/us/mp3/d/develo01.mp3", timeout=5)
print(f"  sample HEAD status: {r.status_code}  (needs API for filename discovery)")

print("\n=== 4. Youdao audio (直接 URL 无需 key) ===")
# Youdao has a well-known TTS URL: dict.youdao.com/dictvoice?type=[0=UK, 1=US, 2=US-male]&audio=WORD
for w in ["development", "hegemony", "rejuvenation"]:
    url_us = f"https://dict.youdao.com/dictvoice?type=1&audio={w}"
    url_uk = f"https://dict.youdao.com/dictvoice?type=2&audio={w}"
    r = S.head(url_us, timeout=10, allow_redirects=True)
    print(f"  {w:20}  Youdao US: HTTP {r.status_code}  bytes={r.headers.get('Content-Length', '?')}")
