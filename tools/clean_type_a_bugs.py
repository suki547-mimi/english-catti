"""Clean Type A translation-pair extraction bugs from unified_vocab.json.

Scope: only phrase-kind entries whose sources contain 'local-classified'
(so we don't touch CATTI syllabus / google-10k / seed corpora).

Two actions:
  * DELETE — truly broken data (colon splits, essay titles, digit-prefix junk)
  * NORMALIZE — legit short terms that were just extracted in ALL CAPS

Delete signatures:
  - en contains 全角 or ASCII colon                 (title split leaked)
  - en contains a quote character                   (broken split)
  - zh starts with a quote character                (broken split)
  - en all-caps AND word count >= 5                 (essay/article title)
  - en starts with a digit followed by punctuation  (numbered list junk)

Normalize signatures (keep, just rewrite en to Title Case / clean form):
  - en all-caps AND word count between 2 and 4      (legit term, wrong case)
"""
from __future__ import annotations
import json
import os
import re
import shutil
from datetime import date
from typing import Any, Dict, List, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCAB = os.path.join(ROOT, "data", "unified_vocab.json")
DELETED_LOG = os.path.join(ROOT, "data", "typeA_deleted.json")
NORMALIZED_LOG = os.path.join(ROOT, "data", "typeA_normalized.json")

# Small English function words that stay lowercase in Title Case.
LOWER_FUNC = {
    "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "for", "to",
    "with", "by", "as", "from", "into", "onto", "over", "under", "up", "off",
    "vs", "vs.",
}


def title_case(s: str) -> str:
    words = re.findall(r"\S+", s)
    if not words:
        return s
    out: List[str] = []
    for i, w in enumerate(words):
        low = w.lower()
        if i not in (0, len(words) - 1) and low in LOWER_FUNC:
            out.append(low)
        else:
            # Preserve apostrophe-connected forms like Children's / Boy's
            if "'" in w:
                parts = w.split("'")
                parts = [parts[0].capitalize()] + [p.lower() for p in parts[1:]]
                out.append("'".join(parts))
            else:
                out.append(w.capitalize())
    return " ".join(out)


def classify(v: Dict[str, Any]) -> Tuple[str, str]:
    """Return (action, reason). action ∈ {'keep', 'delete', 'normalize'}."""
    if v.get("kind") != "phrase":
        return ("keep", "")
    srcs = v.get("sources") or []
    if "local-classified" not in srcs:
        return ("keep", "")
    en = str(v.get("en") or "").strip()
    zh = str(v.get("zh") or "").strip()
    if not en or not zh:
        return ("keep", "")

    words = re.findall(r"[A-Za-z][A-Za-z\-']*", en)

    if "：" in en or ":" in en:
        return ("delete", "COLON_IN_EN")
    if '"' in en or "\u201c" in en or "\u201d" in en:
        return ("delete", "QUOTE_IN_EN")
    if zh[:1] in {'"', "'", "\u201c", "\u201d", "\u2018", "\u2019"}:
        return ("delete", "QUOTE_START_ZH")
    if re.match(r"^\s*\d+\s*[\.\uFF0E、\)）]", en):
        return ("delete", "DIGIT_PREFIX_EN")

    is_all_caps = bool(re.search(r"[A-Za-z]", en)) and en.upper() == en
    if is_all_caps and len(words) >= 5:
        return ("delete", "LONG_ALL_CAPS_TITLE")
    if is_all_caps and 2 <= len(words) <= 4:
        return ("normalize", "SHORT_ALL_CAPS_TERM")

    return ("keep", "")


def main() -> None:
    print(f"[1/5] Backup and load {VOCAB}")
    backup = os.path.join(ROOT, "data", f"unified_vocab.backup-{date.today().isoformat()}.json")
    if not os.path.exists(backup):
        shutil.copyfile(VOCAB, backup)
        print(f"  backup -> {backup}")
    with open(VOCAB, "r", encoding="utf-8") as f:
        vocab: List[Dict[str, Any]] = json.load(f)
    print(f"  loaded: {len(vocab)} entries")

    print("[2/5] Classify entries")
    deleted: List[Dict[str, Any]] = []
    normalized: List[Dict[str, Any]] = []
    kept: List[Dict[str, Any]] = []
    for v in vocab:
        action, reason = classify(v)
        if action == "delete":
            deleted.append({**v, "_delete_reason": reason})
        elif action == "normalize":
            old_en = v["en"]
            new_en = title_case(old_en)
            normalized.append({"id": v.get("id"), "zh": v.get("zh"), "old_en": old_en, "new_en": new_en, "_reason": reason})
            v = {**v, "en": new_en, "headword": new_en.split()[0].lower() if new_en else v.get("headword", "")}
            kept.append(v)
        else:
            kept.append(v)
    print(f"  delete:    {len(deleted)}")
    print(f"  normalize: {len(normalized)}")
    print(f"  keep:      {len(kept) - len(normalized)} pure + {len(normalized)} normalized")

    if not deleted and not normalized:
        print("no changes needed, exit")
        return

    print("[3/5] Preview delete (first 15)")
    for i, d in enumerate(deleted[:15], 1):
        print(f"  {i:>2}. [{d['_delete_reason']:22s}] {d.get('zh')}  ==  {d.get('en')}")
    print("[4/5] Preview normalize (first 15)")
    for i, n in enumerate(normalized[:15], 1):
        print(f"  {i:>2}. [{n['_reason']:22s}] {n['zh']}  :  {n['old_en']}  ->  {n['new_en']}")

    print("[5/5] Write logs and rewrite vocab")
    with open(DELETED_LOG, "w", encoding="utf-8") as f:
        json.dump({"date": date.today().isoformat(), "count": len(deleted), "items": deleted}, f, ensure_ascii=False, indent=2)
    with open(NORMALIZED_LOG, "w", encoding="utf-8") as f:
        json.dump({"date": date.today().isoformat(), "count": len(normalized), "items": normalized}, f, ensure_ascii=False, indent=2)
    with open(VOCAB, "w", encoding="utf-8") as f:
        json.dump(kept, f, ensure_ascii=False, indent=1)

    print(f"\nDone. Removed {len(deleted)}, normalized {len(normalized)}. Logs saved.")


if __name__ == "__main__":
    main()
