"""Strip trailing part-of-speech tags from vocabulary entries.

Examples of cleanup:
  "snore n./ v."                    -> "snore"
  "acute adj."                      -> "acute"
  "accord with v."                  -> "accord with"
  "abundant accomplishment n."      -> "abundant accomplishment"
  "ACLU （...） n."                 -> "ACLU （...）"
  "outrageous adj. / n."            -> "outrageous"
  "raid vt./vi."                    -> "raid"

Entry IDs are preserved so user_state.json references stay valid.
Backup written before mutation.
"""
from __future__ import annotations
import json, re, shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(r"C:\Cursorworkspace\English")
VOCAB = ROOT / "data" / "unified_vocab.json"
BACKUP = ROOT / "data" / f"unified_vocab.backup-pos-{datetime.now():%Y%m%d-%H%M%S}.json"

POS = r"(?:n|v|adj|adv|prep|conj|pron|abbr|num|art|interj|aux|vt|vi|vbl)"
TRAILING = re.compile(
    rf"\s+(?:{POS}\.\s*[/,;]?\s*)+$",
    re.IGNORECASE,
)


def clean(en: str) -> str:
    if not en:
        return en
    cleaned = TRAILING.sub("", en).rstrip()
    return cleaned


def main():
    print(f"Reading {VOCAB}")
    with VOCAB.open("r", encoding="utf-8") as f:
        data = json.load(f)
    total = len(data)

    shutil.copy2(VOCAB, BACKUP)
    print(f"Backup: {BACKUP.name}")

    changes = 0
    sample = []
    for entry in data:
        old = entry.get("en", "")
        new = clean(old)
        if new != old:
            changes += 1
            entry["en"] = new
            if len(sample) < 15:
                sample.append((old, new))

    print(f"\nEntries scanned:  {total}")
    print(f"Entries cleaned:  {changes}")
    print("\nSample:")
    for a, b in sample:
        print(f"  {a!r:60s} -> {b!r}")

    if changes:
        with VOCAB.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\nSaved {VOCAB}")


if __name__ == "__main__":
    main()
