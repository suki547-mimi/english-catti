"""Stage 1 of the Rookie keyword DB: n-gram candidate extraction.

Reads the 22k-line filtered corpus, extracts recurring 2/3/4-word phrases,
filters obvious junk, and dumps ranked candidates plus their example lines.

Output:
  data/rookie/rookie_keyword_candidates.json  ordered by score
Each candidate:
  { phrase, freq, tier_score, examples: [{episode, en}, ...] }

No LLM used here — pure corpus statistics. LLM validation happens in a
separate Stage 2 script (build_rookie_keyword_db.py).
"""
from __future__ import annotations
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(r"C:\Cursorworkspace\English")
SRC = ROOT / "data" / "subs" / "rookie" / "rookie_lines_filtered.json"
MAIN_VOCAB = ROOT / "data" / "unified_vocab.json"
OUT = ROOT / "data" / "rookie" / "rookie_keyword_candidates.json"

STOPWORDS = set("""
a an the and or but so of to in on at for with by from into onto over under about
as is are was were be been being am do does did have has had will would could
should can may might must shall i you he she it we they me him her us them my
your his hers its our their this that these those not no yes if then than when
while because just only also too very really well ok okay
""".split())

TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z'\-]+")


def normalize_ngram(tokens: list[str]) -> str:
    return " ".join(t.lower() for t in tokens)


def tokenize(line: str) -> list[str]:
    return TOKEN_RE.findall(line)


def is_pure_stopwords(tokens: list[str]) -> bool:
    return all(t.lower() in STOPWORDS for t in tokens)


def has_proper_noun_signal(tokens: list[str]) -> bool:
    for t in tokens[1:]:
        if t and t[0].isupper():
            return True
    return False


def load_main_vocab() -> set[str]:
    print(f"Loading main vocab from {MAIN_VOCAB}")
    vocab = json.loads(MAIN_VOCAB.read_text(encoding="utf-8"))
    lc = set()
    for entry in vocab:
        en = str(entry.get("en") or "").strip().lower()
        if en:
            lc.add(en)
    print(f"  {len(lc)} unique lowercased headwords loaded")
    return lc


def main():
    print(f"Reading corpus: {SRC}")
    corpus = json.loads(SRC.read_text(encoding="utf-8"))
    print(f"  {len(corpus)} filtered lines")

    main_vocab_lc = load_main_vocab()

    freq: Counter = Counter()
    example_map: dict[str, list[dict]] = defaultdict(list)

    for entry in corpus:
        en = entry.get("en", "")
        episode = entry.get("episode", "")
        toks = tokenize(en)
        if len(toks) < 2:
            continue
        for n in (2, 3, 4):
            for i in range(len(toks) - n + 1):
                ng_toks = toks[i : i + n]
                lc = normalize_ngram(ng_toks)
                if is_pure_stopwords(ng_toks):
                    continue
                if has_proper_noun_signal(ng_toks):
                    continue
                if lc in main_vocab_lc:
                    continue
                freq[lc] += 1
                if len(example_map[lc]) < 3:
                    example_map[lc].append({"episode": episode, "en": en})

    print(f"Raw n-grams collected: {len(freq)}")
    # Keep phrases appearing at least 3 times
    survived = [(p, c) for p, c in freq.items() if c >= 3]
    print(f"Survivors after freq>=3 filter: {len(survived)}")

    # Score: freq * log(1 + phrase length) — favor multi-word and recurrent
    import math
    scored = []
    for phrase, count in survived:
        words = phrase.split()
        length_bonus = math.log(1 + len(words))
        # tiny boost for phrases starting with a common verb ("brush off", "hold up")
        rare_bonus = 0.5 if len(words) >= 3 else 0.0
        score = count * (1 + length_bonus) + rare_bonus
        scored.append((phrase, count, score))
    scored.sort(key=lambda x: x[2], reverse=True)

    out = [
        {
            "phrase": phrase,
            "freq": count,
            "score": round(score, 2),
            "examples": example_map[phrase],
        }
        for phrase, count, score in scored
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nSaved {len(out)} candidates to {OUT}")
    print("\nTop 30 by score:")
    for c in out[:30]:
        print(f"  [{c['freq']:>3}x, {c['score']:>6.2f}]  {c['phrase']}")
    print("\nSample 5 mid-tier:")
    mid = out[len(out) // 2 : len(out) // 2 + 5]
    for c in mid:
        print(f"  [{c['freq']:>3}x, {c['score']:>6.2f}]  {c['phrase']}")


if __name__ == "__main__":
    main()
