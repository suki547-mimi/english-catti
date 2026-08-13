"""Filter The Rookie dialogue lines down to a corpus of quality sentences.

Keeps lines that are:
- >= 8 words (meaningful sentence, not "Yeah" / "Copy that")
- <= 25 words (not run-on, easier for Gate 5 language cloze)
- Have letters (not all punct/digits)
- Not verbatim duplicates
- Not obvious sound-cue residue (heavy caps ratio)

Writes data/subs/rookie/rookie_lines_filtered.json:
  [{ episode: "s01e01", en: "..." }, ...]
"""
from __future__ import annotations
import json
import re
from pathlib import Path

SRC = Path(r"C:\Cursorworkspace\English\data\subs\rookie\rookie_dialogues.json")
DST = Path(r"C:\Cursorworkspace\English\data\subs\rookie\rookie_lines_filtered.json")

MIN_WORDS = 8
MAX_WORDS = 25


def caps_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isupper()) / len(letters)


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    print(f"Loaded {len(data)} raw lines")

    seen: set[str] = set()
    kept: list[dict] = []
    for item in data:
        en = (item.get("en") or "").strip()
        if not en:
            continue
        words = en.split()
        if not (MIN_WORDS <= len(words) <= MAX_WORDS):
            continue
        if not any(c.isalpha() for c in en):
            continue
        if caps_ratio(en) > 0.7:
            continue
        # Reduce all-lowercase key to dedupe minor punct differences
        key = re.sub(r"[^\w\s]", "", en.lower())
        key = re.sub(r"\s+", " ", key).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        kept.append({"episode": item["episode"], "en": en})

    DST.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Kept {len(kept)} unique quality lines ({100 * len(kept) / len(data):.1f}%)")
    print(f"Sample (first 5):")
    for k in kept[:5]:
        print(f"  [{k['episode']}] {k['en']}")


if __name__ == "__main__":
    main()
