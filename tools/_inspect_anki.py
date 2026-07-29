"""Inspect Anki notes - check which models have readable content vs encrypted."""
import json, re, html

DATA = r'C:\Cursorworkspace\English\data\external\zhangpeiji_anki.json'
notes = json.load(open(DATA, 'r', encoding='utf-8'))
print(f"Total notes: {len(notes)}")

# Group by mid
by_mid = {}
for n in notes:
    by_mid.setdefault(n['mid'], []).append(n)

MODEL_NAMES = {
    "1676613179086": "问答题",
    "1619368562021": "基础的-加密",
    "1639928733995": "张培基英译解析-加密",
    "1664031487855": "Q群710917236-加密",
}

def is_encrypted(text: str) -> bool:
    """Heuristic: encrypted fields look like random base64-ish garbage."""
    if not text.strip(): return False
    # Encrypted content in this deck seems to start with unicode symbols like ≯
    # and be very long base64-ish strings
    if len(text) > 100 and re.match(r'^[\W_]?[A-Za-z0-9+/=]{50,}', text.strip()):
        return True
    # Also detect '⩯#' or '≯#' style prefixes
    if text.strip().startswith(('⩯#', '≯#', '⧝#', 'ANKICRYPT')):
        return True
    return False

def strip_html_and_media(text: str) -> str:
    text = re.sub(r'\[sound:[^\]]+\]', ' [SOUND] ', text)
    text = re.sub(r'<[^>]+>', ' ', html.unescape(text))
    return re.sub(r'\s+', ' ', text).strip()

for mid, notes_list in sorted(by_mid.items(), key=lambda x: -len(x[1])):
    name = MODEL_NAMES.get(str(mid), f"unknown-{mid}")
    print(f"\n=== model {mid} ({name}) : {len(notes_list)} notes ===")
    # Analyze each field position
    n_fields = len(notes_list[0]['fields'])
    for fi in range(n_fields):
        readable = 0; encrypted = 0; empty = 0; total_len = 0; samples = []
        for n in notes_list:
            f = n['fields'][fi] if fi < len(n['fields']) else ''
            if not f.strip():
                empty += 1; continue
            if is_encrypted(f):
                encrypted += 1
            else:
                readable += 1
                total_len += len(strip_html_and_media(f))
                if len(samples) < 2:
                    samples.append(strip_html_and_media(f)[:150])
        avg_len = total_len // max(1, readable)
        print(f"  field[{fi}]: readable={readable}, encrypted={encrypted}, empty={empty}, avg_readable_len={avg_len}")
        for s in samples:
            print(f"     sample: {s}")
