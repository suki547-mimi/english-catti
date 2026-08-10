"""Scan unified_vocab.json for suspicious zh <-> en pairs where the two sides
are unlikely to be literal translations (mostly official Chinese -> English
idiomatic renderings from the CATTI / MFA / 政治政府 corpora).

Outputs:
  data/translation_review.json     full ranked list (top N)
  prints top 40 to stdout for inline review.

Heuristic (no LLM call): score higher = more suspicious.
"""
from __future__ import annotations
import json
import os
import re
import sys
from typing import Any, Dict, List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCAB = os.path.join(ROOT, "data", "unified_vocab.json")
OUT = os.path.join(ROOT, "data", "translation_review.json")

# Common Chinese noun-phrase tail characters (nominal, stative).
ZH_NOUN_TAILS = [
    "信心", "决心", "耐心", "初心", "雄心",
    "建设", "发展", "改革", "工作", "事业", "任务", "使命",
    "精神", "道路", "理论", "思想", "体系", "体制", "机制", "制度",
    "意识", "自信", "根本", "本质", "核心", "格局", "布局", "局面",
    "水平", "能力", "质量", "效率", "力度", "程度",
    "意义", "作用", "价值", "地位", "关系", "利益",
    "国家", "民族", "人民", "党", "政府",
    "现代化", "全球化", "一体化", "市场化",
    "政策", "路线", "方针", "战略", "规划",
    "目标", "宗旨", "原则", "规律", "特色",
    "文化", "文明", "生态", "环境", "秩序",
    "梦", "梦想",
]

# English verb heads common in political/business idiomatic collocations.
EN_VERB_HEADS = {
    "proceed", "uphold", "foster", "promote", "deepen", "strengthen", "adhere",
    "pursue", "advance", "enhance", "reach", "achieve", "ensure", "safeguard",
    "make", "take", "hold", "provide", "boost", "drive", "forge", "keep",
    "remain", "follow", "seek", "meet", "carry", "build", "grow", "expand",
    "shore", "consolidate", "cultivate", "spur", "unlock", "unleash", "unite",
    "stand", "stay", "stick", "step", "strive", "focus", "invest", "commit",
    "combat", "counter", "curb", "tackle", "resolve", "settle", "handle",
    "raise", "lift", "boost", "put", "let", "have", "help", "bring", "get",
    "give", "run", "set", "turn", "become", "remain",
    # Adverbs / functional words that often start collocation phrases.
    "unwaveringly", "firmly", "resolutely", "steadfastly",
}

# Prepositions strongly indicating verbal collocation (rare in noun compounds).
EN_PREPS = {"with", "of", "on", "in", "for", "to", "at", "by", "into", "onto", "upon", "under", "over", "against"}

# Political / policy topics most prone to this issue.
SUSPECT_TOPICS = {
    "04-政治政府",
    "09-热门话题",
    "10-金融经济",
    "11-科技",
    "12-商务英语",
    "中国特色政治",
}


def zh_char_count(s: str) -> int:
    return sum(1 for c in s if "\u4e00" <= c <= "\u9fff")


def zh_ends_in_noun_tail(zh: str) -> str | None:
    for tail in ZH_NOUN_TAILS:
        if zh.endswith(tail):
            return tail
    return None


def score_entry(v: Dict[str, Any]) -> Dict[str, Any]:
    zh = str(v.get("zh") or "").strip()
    en = str(v.get("en") or "").strip()
    if not zh or not en:
        return {"score": 0}
    zh_cc = zh_char_count(zh)
    words = re.findall(r"[A-Za-z][A-Za-z\-']*", en)
    en_wc = len(words)
    words_lc = [w.lower() for w in words]

    reasons: List[str] = []
    score = 0.0

    # 1. Length mismatch (zh short + en long is prototypical).
    if zh_cc <= 4 and en_wc >= 4:
        score += 3
        reasons.append(f"length mismatch zh={zh_cc}chars en={en_wc}words")
    elif zh_cc <= 6 and en_wc >= 5:
        score += 2
        reasons.append(f"length mismatch zh={zh_cc}chars en={en_wc}words")

    # 2. English starts with a collocation-head verb / adverb.
    if words_lc and words_lc[0] in EN_VERB_HEADS:
        score += 2
        reasons.append(f"en verb-head '{words_lc[0]}'")

    # 3. English contains a preposition (verbal collocation signal).
    if any(w in EN_PREPS for w in words_lc):
        score += 1
        reasons.append("en has preposition")

    # 4. Chinese ends in a noun tail (name-like / stative).
    tail = zh_ends_in_noun_tail(zh)
    if tail:
        score += 1.5
        reasons.append(f"zh noun-tail '{tail}'")

    # 5. Political / policy topic bump.
    topic = str(v.get("topic") or "")
    if topic in SUSPECT_TOPICS:
        score += 1
        reasons.append(f"suspect topic '{topic}'")

    # 6. English is ALL CAPS or Title Case suggesting it was extracted from a
    #    heading — often a translation-of-Chinese-headline artifact.
    if en.isupper() and en_wc >= 2:
        score += 1
        reasons.append("en ALL CAPS")

    # 7. Both sides pure noun compounds (no verb head, no preposition, no tail
    #    match) → probably fine, dampen.
    if not tail and (not words_lc or words_lc[0] not in EN_VERB_HEADS) and not any(
        w in EN_PREPS for w in words_lc
    ):
        score *= 0.5

    return {"score": round(score, 2), "reasons": reasons, "zh_cc": zh_cc, "en_wc": en_wc}


def main() -> None:
    print(f"[1/3] Load {VOCAB}")
    with open(VOCAB, "r", encoding="utf-8") as f:
        vocab: List[Dict[str, Any]] = json.load(f)
    print(f"  total entries: {len(vocab)}")

    print("[2/3] Score phrase-type entries from local-classified sources")
    scored: List[Dict[str, Any]] = []
    for v in vocab:
        if v.get("kind") != "phrase":
            continue
        srcs = v.get("sources") or []
        if not any(s == "local-classified" or s in SUSPECT_TOPICS for s in srcs):
            continue
        s = score_entry(v)
        if s.get("score", 0) < 3:
            continue
        scored.append({
            "id": v.get("id"),
            "en": v.get("en"),
            "zh": v.get("zh"),
            "topic": v.get("topic"),
            "sources": srcs,
            "score": s["score"],
            "reasons": s["reasons"],
        })
    scored.sort(key=lambda x: (-x["score"], x["topic"] or "", x["en"] or ""))
    print(f"  suspicious candidates: {len(scored)}")

    top = scored[:200]
    print(f"[3/3] Write top {len(top)} to {OUT}")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"total_flagged": len(scored), "shown": len(top), "items": top}, f, ensure_ascii=False, indent=2)

    # Inline preview: top 40
    print("\n===== TOP 40 SUSPICIOUS PAIRS (preview) =====")
    for i, x in enumerate(top[:40], 1):
        print(f"{i:>2}. [{x['score']}] {x['zh']}  ==  {x['en']}   [{x['topic']}]")
        # print("     reasons:", ", ".join(x['reasons']))
    print(f"\nFull list in: {OUT}")


if __name__ == "__main__":
    main()
