"""Scrape MFA (Ministry of Foreign Affairs) Regular Press Briefings.

Extracts Q&A pairs from EN briefings and aligns them with matching CN briefings.

Output:
  data/mfa_dialog_pairs.json  - bilingual Q&A pairs (question, answer_en, answer_zh, ...)
  data/mfa_articles.json      - per-briefing metadata + raw paragraphs
  data/mfa_urls.txt           - URL manifest

Approach
--------
1. Enumerate EN briefing URLs from paginated index (past N months)
2. Enumerate CN briefing URLs same way, index by date -> URL
3. For each EN briefing, look up matching CN briefing by date
4. Fetch both, split into paragraphs, extract Q&A pairs
5. Align pairs by index position (both languages have same order & count)
"""
from __future__ import annotations
import os, re, sys, json, time, hashlib
from typing import List, Dict, Optional, Tuple
import requests
from bs4 import BeautifulSoup

ROOT     = r"C:\Cursorworkspace\English"
OUTDIR   = os.path.join(ROOT, "data")

EN_LIST_TMPL = "https://www.fmprc.gov.cn/eng/xw/fyrbt/lxjzh/index_{}.html"  # index_1.html etc
EN_LIST_HOME = "https://www.fmprc.gov.cn/eng/xw/fyrbt/lxjzh/"
CN_LIST_TMPL = "https://www.fmprc.gov.cn/fyrbt_673021/jzhsl_673025/index_{}.shtml"
CN_LIST_HOME = "https://www.fmprc.gov.cn/fyrbt_673021/jzhsl_673025/"

HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
SLEEP_S = 0.35

# Configuration - scrape recent 2 months of press briefings
CUTOFF_YMD = "2026-06-01"      # scrape briefings dated on or after this
MAX_LIST_PAGES = 15            # enumerate up to N index pages

S = requests.Session()
S.headers.update(HDR)

# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------
def ymd_from_url(url: str) -> Optional[str]:
    m = re.search(r"/(\d{4})(\d{2})/t\1\2(\d{2})_", url)
    if not m: return None
    y, mo, d = m.group(1), m.group(2), m.group(3)
    return f"{y}-{mo}-{d}"

def http_get(url: str, retries: int = 2) -> Optional[requests.Response]:
    for i in range(retries + 1):
        try:
            r = S.get(url, timeout=15)
            r.encoding = "utf-8"
            if r.status_code == 200:
                return r
        except Exception as e:
            print(f"  ! retry {i} {url}: {e}")
        time.sleep(0.5)
    return None

# ---------------------------------------------------------------------------
# 1. Enumerate index pages for one language
# ---------------------------------------------------------------------------
RE_EN_BRIEFING = re.compile(
    r'href="\.?/?([^"]*?/?(?:lxjzh/)?(\d{6})/t(\d{8})_(\d+)\.html?)"[^>]*>'
    r'([^<]{4,200})</a>', re.I)
RE_CN_BRIEFING = re.compile(
    r'href="\.?/?([^"]*?(\d{6})/t(\d{8})_(\d+)\.shtml)"[^>]*>'
    r'([^<]{4,200})</a>', re.I)

def enumerate_lang(list_home: str, list_tmpl: str, briefing_regex, keyword: str,
                   cutoff: str, base_url: str, max_pages: int) -> List[Dict]:
    """keyword must appear in link text to be considered a briefing article.
    - EN keyword: 'Regular Press Conference'
    - CN keyword: '例行记者会' (kept in title)
    Returns list of {date, url, title}"""
    seen_urls = set()
    out: List[Dict] = []
    for page in range(0, max_pages + 1):
        url = list_home if page == 0 else list_tmpl.format(page)
        print(f"    list page {page}: {url}")
        r = http_get(url)
        if not r:
            print(f"      ! failed")
            break
        html = r.text
        matches = list(briefing_regex.finditer(html))
        found = 0
        min_date_on_page = None
        for m in matches:
            href, yyyymm, yyyymmdd, hid, title = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5).strip()
            if keyword not in title:
                continue
            date = f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:8]}"
            if not min_date_on_page or date < min_date_on_page:
                min_date_on_page = date
            if date < cutoff:
                continue
            # Absolute URL
            if not href.startswith("http"):
                # base_url has trailing /
                if href.startswith("./"): href = href[2:]
                if href.startswith("/"):
                    abs_url = "https://www.fmprc.gov.cn" + href
                else:
                    abs_url = base_url + href
            else:
                abs_url = href
            if abs_url in seen_urls: continue
            seen_urls.add(abs_url)
            out.append({"date": date, "url": abs_url, "title": title})
            found += 1
        print(f"      +{found}  page-min-date={min_date_on_page}")
        if min_date_on_page and min_date_on_page < cutoff:
            print(f"      past cutoff, stopping")
            break
        time.sleep(SLEEP_S)
    # Deduplicate by URL, keep latest date
    return out

# ---------------------------------------------------------------------------
# 2. Extract Q&A pairs from a single briefing page
# ---------------------------------------------------------------------------
# Speaker name in EN: word or a couple of words with title case, ending with ":"
# e.g. "Lin Jian:", "Bloomberg:", "Reuters:", "CCTV:", "Mao Ning:"
RE_EN_SPEAKER = re.compile(r"^\s*([A-Z][A-Za-z0-9\-\.'\s]{1,60}):\s*")
# CN spokespersons and question intros
CN_SPOKESPERSONS = {"林剑", "毛宁", "汪文斌", "华春莹", "赵立坚", "耿爽",
                    "王文斌", "陆慷", "洪磊", "郭嘉昆"}
# Speaker line = any short prefix (up to 40 chars, no colon) followed by ":" or "：".
# Must contain at least one Chinese character to qualify.
RE_CN_SPEAKER = re.compile(r"^\s*([^\r\n:：]{1,40})[:：]\s*")
RE_HAS_CJK = re.compile(r"[\u4e00-\u9fff]")

BOILERPLATE = (
    "Copyright", "版权所有", "京ICP", "关闭", "打印", "字号",
    "Foreign Ministry of the People's Republic of China",
    "分享", "Recommend to friends",
)

def _extract_paragraphs(html: str) -> List[str]:
    soup = BeautifulSoup(html, "lxml")
    out: List[str] = []
    for p in soup.find_all(["p", "div"]):
        # Skip if it has block children (avoid outer div duplicates)
        if p.find(["p", "div"]):
            continue
        t = p.get_text(" ", strip=True)
        if not t or len(t) < 5: continue
        if any(k in t for k in BOILERPLATE): continue
        if out and out[-1] == t: continue
        out.append(t)
    return out

def _extract_qa_pairs_en(paragraphs: List[str]) -> List[Dict]:
    """Group paragraphs into Q -> A pairs based on speaker prefixes."""
    pairs: List[Dict] = []
    i = 0
    n = len(paragraphs)
    while i < n:
        text = paragraphs[i]
        m = RE_EN_SPEAKER.match(text)
        if not m:
            i += 1; continue
        speaker = m.group(1).strip().rstrip(":")
        body = text[m.end():].strip()
        # Heuristic: if speaker looks like the spokesperson (Lin Jian / Mao Ning / etc.),
        # this is an ANSWER continuation. Otherwise it's a QUESTION.
        is_spokesperson = speaker in {"Lin Jian", "Mao Ning", "Wang Wenbin",
                                       "Hua Chunying", "Zhao Lijian", "Geng Shuang",
                                       "Guo Jiakun"}
        if is_spokesperson:
            # Answer without preceding question captured (e.g. an announcement) — skip
            i += 1; continue
        # Collect continuation lines for the question (if the question spans lines)
        q_parts = [body]
        j = i + 1
        while j < n:
            next_p = paragraphs[j]
            nm = RE_EN_SPEAKER.match(next_p)
            if nm:
                break
            q_parts.append(next_p)
            j += 1
        question = " ".join(q_parts).strip()
        # Now collect answer paragraphs starting at j
        answer_speaker = None
        a_parts: List[str] = []
        while j < n:
            nxt = paragraphs[j]
            nm = RE_EN_SPEAKER.match(nxt)
            if nm:
                spk = nm.group(1).strip().rstrip(":")
                if spk in {"Lin Jian", "Mao Ning", "Wang Wenbin", "Hua Chunying",
                          "Zhao Lijian", "Geng Shuang", "Guo Jiakun"}:
                    answer_speaker = spk
                    a_parts.append(nxt[nm.end():].strip())
                    j += 1
                    # Continuation of answer without prefix
                    while j < n and not RE_EN_SPEAKER.match(paragraphs[j]):
                        a_parts.append(paragraphs[j])
                        j += 1
                    break
                else:
                    # A different speaker (unexpected) — skip
                    break
            else:
                # Answer body continuation before any speaker prefix — collect
                a_parts.append(nxt)
                j += 1
        answer = " ".join(a_parts).strip()
        if question and answer:
            pairs.append({
                "questioner": speaker,
                "spokesperson": answer_speaker or "",
                "question": question,
                "answer": answer,
            })
        i = j
    return pairs

def _extract_qa_pairs_cn(paragraphs: List[str]) -> List[Dict]:
    """Same logic as EN but for Chinese briefings."""
    def _is_speaker_line(text: str) -> Optional[Tuple[str, str]]:
        """Return (speaker_prefix, body) if line starts with 'SPEAKER:' with CJK.
        Reject speakers that don't contain a CJK char (nav/menu lines with colons)."""
        mm = RE_CN_SPEAKER.match(text)
        if not mm: return None
        prefix = mm.group(1).strip()
        if not RE_HAS_CJK.search(prefix): return None
        # Reject overly long "speaker" that is actually running text (short heuristic)
        if len(prefix) > 30: return None
        body = text[mm.end():].strip()
        return prefix, body

    pairs: List[Dict] = []
    i = 0
    n = len(paragraphs)
    while i < n:
        parsed = _is_speaker_line(paragraphs[i])
        if not parsed:
            i += 1; continue
        speaker, body = parsed
        is_spokesperson = speaker in CN_SPOKESPERSONS
        if is_spokesperson:
            i += 1; continue
        # Question body + continuation
        q_parts = [body]
        j = i + 1
        while j < n and not _is_speaker_line(paragraphs[j]):
            q_parts.append(paragraphs[j]); j += 1
        question = " ".join(q_parts).strip()
        # Answer
        answer_speaker = None
        a_parts: List[str] = []
        while j < n:
            nxt_parsed = _is_speaker_line(paragraphs[j])
            if nxt_parsed and nxt_parsed[0] in CN_SPOKESPERSONS:
                answer_speaker = nxt_parsed[0]
                a_parts.append(nxt_parsed[1]); j += 1
                while j < n and not _is_speaker_line(paragraphs[j]):
                    a_parts.append(paragraphs[j]); j += 1
                break
            elif nxt_parsed:
                # Different speaker: skip
                break
            else:
                a_parts.append(paragraphs[j]); j += 1
        answer = " ".join(a_parts).strip()
        if question and answer:
            pairs.append({
                "questioner": speaker,
                "spokesperson": answer_speaker or "",
                "question": question,
                "answer": answer,
            })
        i = j
    return pairs

# ---------------------------------------------------------------------------
# 3. Main pipeline
# ---------------------------------------------------------------------------
def main():
    os.makedirs(OUTDIR, exist_ok=True)

    print(f"[1/4] Enumerate EN briefings (cutoff >= {CUTOFF_YMD})")
    en_list = enumerate_lang(
        EN_LIST_HOME, EN_LIST_TMPL, RE_EN_BRIEFING,
        keyword="Regular Press Conference",
        cutoff=CUTOFF_YMD,
        base_url=EN_LIST_HOME,
        max_pages=MAX_LIST_PAGES,
    )
    print(f"  -> {len(en_list)} EN briefings\n")

    print(f"[2/4] Enumerate CN briefings")
    cn_list = enumerate_lang(
        CN_LIST_HOME, CN_LIST_TMPL, RE_CN_BRIEFING,
        keyword="例行记者会",
        cutoff=CUTOFF_YMD,
        base_url=CN_LIST_HOME,
        max_pages=MAX_LIST_PAGES,
    )
    print(f"  -> {len(cn_list)} CN briefings\n")

    # Index CN by date
    cn_by_date: Dict[str, Dict] = {}
    for c in cn_list:
        cn_by_date.setdefault(c["date"], c)  # first match wins

    print(f"[3/4] Fetch & extract Q&A pairs")
    articles: List[Dict] = []
    all_pairs: List[Dict] = []
    for i, en in enumerate(en_list, 1):
        cn = cn_by_date.get(en["date"])
        rec = {
            "date": en["date"],
            "en_url": en["url"],
            "en_title": en["title"],
            "cn_url": cn["url"] if cn else None,
            "cn_title": cn["title"] if cn else None,
            "en_pairs": [],
            "cn_pairs": [],
        }
        r_en = http_get(en["url"])
        if r_en:
            en_paras = _extract_paragraphs(r_en.text)
            rec["en_pairs"] = _extract_qa_pairs_en(en_paras)
        time.sleep(SLEEP_S)
        if cn:
            r_cn = http_get(cn["url"])
            if r_cn:
                cn_paras = _extract_paragraphs(r_cn.text)
                rec["cn_pairs"] = _extract_qa_pairs_cn(cn_paras)
            time.sleep(SLEEP_S)
        articles.append(rec)

        # Align by index position — assume same order
        ne, nc = len(rec["en_pairs"]), len(rec["cn_pairs"])
        n_aligned = min(ne, nc)
        for k in range(n_aligned):
            pe, pc = rec["en_pairs"][k], rec["cn_pairs"][k]
            all_pairs.append({
                "date": en["date"],
                "en_url": en["url"],
                "cn_url": rec["cn_url"],
                "index": k,
                "questioner_en": pe["questioner"],
                "questioner_cn": pc["questioner"],
                "question_en": pe["question"],
                "question_cn": pc["question"],
                "answer_en": pe["answer"],
                "answer_cn": pc["answer"],
            })

        if i % 5 == 0 or i == len(en_list):
            print(f"  [{i}/{len(en_list)}] {en['date']} en_pairs={ne} cn_pairs={nc} aligned={n_aligned}")

    print(f"  -> total aligned pairs: {len(all_pairs)}")

    print(f"[4/4] Writing outputs")
    with open(os.path.join(OUTDIR, "mfa_articles.json"), "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUTDIR, "mfa_dialog_pairs.json"), "w", encoding="utf-8") as f:
        json.dump(all_pairs, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUTDIR, "mfa_urls.txt"), "w", encoding="utf-8") as f:
        for r in articles:
            f.write(f"{r['date']}\tEN\t{r['en_url']}\n")
            if r['cn_url']:
                f.write(f"{r['date']}\tCN\t{r['cn_url']}\n")

    # Summary
    total_en_pairs = sum(len(a["en_pairs"]) for a in articles)
    total_cn_pairs = sum(len(a["cn_pairs"]) for a in articles)
    print(f"\n[done]")
    print(f"  briefings scraped: {len(articles)}")
    print(f"  EN Q&A pairs:      {total_en_pairs}")
    print(f"  CN Q&A pairs:      {total_cn_pairs}")
    print(f"  Aligned bilingual: {len(all_pairs)}")
    print(f"  Outputs -> {OUTDIR}\\mfa_dialog_pairs.json / mfa_articles.json / mfa_urls.txt")

if __name__ == "__main__":
    main()
