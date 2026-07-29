"""Scrape ChinaDaily 每日一词 last 12 months (~300 articles).

Output:
  data/chinadaily_vocab.json      - term pairs (title + 相关词汇 section)
  data/chinadaily_sentences.json  - bilingual example sentences (重要讲话 + body opening)
  data/chinadaily_articles.json   - raw metadata per article
  data/chinadaily_urls.txt        - flat list of URLs scraped
"""
from __future__ import annotations
import os, re, sys, json, time, hashlib
from typing import List, Dict, Optional, Tuple
import requests
from bs4 import BeautifulSoup

ROOT     = r"C:\Cursorworkspace\English"
OUTDIR   = os.path.join(ROOT, "data")
LIST_URL = "https://language.chinadaily.com.cn/thelatest/page_{}.html"
HDR = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Connection": "keep-alive",
}
CUTOFF = (2024, 5, 1)   # scrape articles published from this date onward
SLEEP_S = 0.35          # polite delay between requests

SESSION = requests.Session()
SESSION.headers.update(HDR)

# ---------------------------------------------------------------------------
# 1. Enumerate 每日一词 article URLs from listing pages
# ---------------------------------------------------------------------------
RE_DAILY_LINK = re.compile(
    r'<a[^>]+href="([^"]*?/a/(\d{6})/(\d{2})/WS[a-f0-9]+\.html)"[^>]*>'
    r'([^<]{4,200})</a>', re.I)

def article_id(url: str) -> str:
    m = re.search(r'WS([a-f0-9]+)\.html', url)
    return m.group(1) if m else hashlib.sha1(url.encode()).hexdigest()[:12]

def _normalize(url: str) -> str:
    if url.startswith("//"): url = "https:" + url
    if url.startswith("http:"): url = "https:" + url[5:]
    return url

def enumerate_urls(cutoff: Tuple[int,int,int], max_pages: int = 30) -> List[Dict]:
    seen: set = set()
    picked: List[Dict] = []
    cy, cm, cd = cutoff
    for page in range(1, max_pages + 1):
        url = LIST_URL.format(page)
        print(f"  [list] page {page:>2}: {url}")
        try:
            r = SESSION.get(url, timeout=15)
            r.encoding = "utf-8"
        except Exception as e:
            print(f"    !! {e}")
            break
        if r.status_code != 200:
            print(f"    !! HTTP {r.status_code}, stopping")
            break
        html = r.text
        found = 0
        page_min_year = None
        for m in RE_DAILY_LINK.finditer(html):
            href, yyyymm, dd, title = m.group(1), m.group(2), m.group(3), m.group(4).strip()
            # Only keep 每日一词 column articles
            if "每日一词" not in title:
                continue
            yr, mo = int(yyyymm[:4]), int(yyyymm[4:6])
            day = int(dd)
            if (yr, mo, day) < cutoff:
                # skip but keep counting to detect end
                page_min_year = (yr, mo, day) if page_min_year is None else min(page_min_year, (yr, mo, day))
                continue
            page_min_year = (yr, mo, day) if page_min_year is None else min(page_min_year, (yr, mo, day))
            href = _normalize(href)
            if href in seen: continue
            seen.add(href)
            picked.append({
                "url": href, "title_hint": title,
                "date": f"{yr:04d}-{mo:02d}-{day:02d}",
                "id": article_id(href),
            })
            found += 1
        print(f"    +{found} new (min date on page: {page_min_year})")
        # If all articles on this page are older than cutoff, we're done.
        if page_min_year and page_min_year < cutoff:
            print(f"    <- past cutoff, stopping")
            break
        time.sleep(SLEEP_S)
    return picked

# ---------------------------------------------------------------------------
# 2. Parse a single article
# ---------------------------------------------------------------------------
RE_HAS_ZH = re.compile(r"[\u4e00-\u9fff]")
RE_HAS_EN = re.compile(r"[A-Za-z]")
RE_TITLE  = re.compile(r"每日一词\s*[\|｜]\s*(.+?)(?:\s*-\s*Chinadaily|\s*_中国日报|$)", re.S)

def _paras_from_html(html: str) -> List[str]:
    """Return list of visible paragraph texts from article body."""
    soup = BeautifulSoup(html, "lxml")
    # Article body container - ChinaDaily uses #Content div
    body = soup.find(id="Content") or soup.find("div", class_="Content") or soup
    paras: List[str] = []
    for p in body.find_all(["p", "h2", "h3", "div"]):
        # Skip if nested inside another <p> we already handled
        t = p.get_text(" ", strip=True)
        if not t or len(t) < 4: continue
        # Deduplicate by content prefix
        if paras and paras[-1] == t: continue
        paras.append(t)
    # Filter out nav/footer boilerplate
    paras = [p for p in paras if not any(k in p for k in [
        "版权", "京ICP", "违者必究", "转载", "招聘", "联系方式",
    ])]
    return paras

def _extract_term_from_title(page_title: str) -> Optional[Tuple[str, str]]:
    """From '每日一词 | 中华全国总工会 All-China Federation of Trade Unions' -> pair."""
    m = RE_TITLE.search(page_title.replace("\n", " "))
    if not m: return None
    inner = m.group(1).strip()
    # Split ZH cluster from EN cluster using the same _best_split idea as build_vocab
    zh_positions = [i for i, c in enumerate(inner) if "\u4e00" <= c <= "\u9fff"]
    en_positions = [i for i, c in enumerate(inner) if c.isascii() and c.isalpha()]
    if not zh_positions or not en_positions:
        return None
    if zh_positions[-1] < en_positions[-1]:
        cut = zh_positions[-1] + 1
        zh, en = inner[:cut].strip(), inner[cut:].strip()
    else:
        cut = zh_positions[0]
        en, zh = inner[:cut].strip(), inner[cut:].strip()
    zh = zh.strip("|｜ -").strip()
    en = en.strip("|｜ -").strip()
    if len(zh) >= 2 and len(en) >= 2:
        return zh, en
    return None

def _split_sections(paras: List[str]) -> Dict[str, List[str]]:
    """Group paragraphs by section header markers."""
    sec: Dict[str, List[str]] = {"lead": [], "知识点": [], "重要讲话": [], "相关词汇": []}
    cur = "lead"
    for p in paras:
        s = p.strip()
        # Detect section change
        if "【知识点】" in s or s.startswith("知识点"):
            cur = "知识点"
            s = s.replace("【知识点】", "").strip()
            if not s: continue
        elif "【重要讲话】" in s or s.startswith("重要讲话"):
            cur = "重要讲话"
            s = s.replace("【重要讲话】", "").strip()
            if not s: continue
        elif "【相关词汇】" in s or s.startswith("相关词汇"):
            cur = "相关词汇"
            s = s.replace("【相关词汇】", "").strip()
            if not s: continue
        sec[cur].append(s)
    return sec

def _pair_bilingual(lines: List[str]) -> List[Tuple[str, str]]:
    """Given alternating (or same-line) ZH/EN paragraphs, produce pairs."""
    out: List[Tuple[str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        has_z = bool(RE_HAS_ZH.search(line))
        has_e = bool(RE_HAS_EN.search(line))
        # Case A: single line contains both ZH and EN -> internal split
        if has_z and has_e and len(line) > 20:
            # If the line has a long EN run at the end and ZH before, split
            zh_pos = [j for j, c in enumerate(line) if "\u4e00" <= c <= "\u9fff"]
            en_pos = [j for j, c in enumerate(line) if c.isascii() and c.isalpha()]
            if zh_pos and en_pos and zh_pos[-1] < en_pos[-1]:
                cut = zh_pos[-1] + 1
                zh, en = line[:cut].strip(), line[cut:].strip()
                if len(zh) >= 3 and len(en) >= 3:
                    out.append((zh, en))
                i += 1; continue
        # Case B: this line ZH, next line EN
        if has_z and not has_e and i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if RE_HAS_EN.search(nxt) and not RE_HAS_ZH.search(nxt):
                out.append((line, nxt))
                i += 2; continue
        i += 1
    return out

def _parse_related(text: str) -> List[Tuple[str, str]]:
    """Parse the 相关词汇 section.

    Entries may be separated by newline / semicolon, OR simply concatenated with
    spaces (e.g. 'ZH1 EN1 words ZH2 EN2 words'). We split first at any
    newline/semicolon, then within each chunk we also break at every
    English-letter -> Chinese-char transition (that boundary is the start of a
    fresh pair).
    """
    text = text.strip()
    if not text:
        return []

    def is_zh(c): return "\u4e00" <= c <= "\u9fff"
    def is_en(c): return c.isascii() and c.isalpha()

    # First split by explicit separators
    coarse = [c.strip() for c in re.split(r"[\r\n；;]+", text) if c.strip()]

    chunks: List[str] = []
    for c in coarse:
        # find start indices where prev char is EN letter and cur is ZH
        starts = [0]
        for i in range(1, len(c)):
            if is_en(c[i-1]) and is_zh(c[i]):
                starts.append(i)
        for k, s in enumerate(starts):
            e = starts[k+1] if k+1 < len(starts) else len(c)
            piece = c[s:e].strip(" .,;，。；:：\t")
            if piece:
                chunks.append(piece)

    out: List[Tuple[str, str]] = []
    for chunk in chunks:
        zh_pos = [j for j, ch in enumerate(chunk) if is_zh(ch)]
        en_pos = [j for j, ch in enumerate(chunk) if is_en(ch)]
        if not zh_pos or not en_pos:
            continue
        if zh_pos[-1] < en_pos[-1]:          # ZH-first (usual)
            cut = zh_pos[-1] + 1
            zh, en = chunk[:cut].strip(), chunk[cut:].strip()
        else:                                 # EN-first (rare here)
            cut = zh_pos[0]
            en, zh = chunk[:cut].strip(), chunk[cut:].strip()
        zh = zh.strip(" |｜-,.，。；:：")
        en = en.strip(" |｜-,.，。；:：")
        if 2 <= len(zh) <= 60 and 2 <= len(en) <= 150:
            out.append((zh, en))
    return out

def parse_article(html: str, meta: Dict) -> Dict:
    # Title from <title>
    soup = BeautifulSoup(html, "lxml")
    page_title = (soup.title.get_text(strip=True) if soup.title else meta.get("title_hint","")) or ""
    title_pair = _extract_term_from_title(page_title)

    paras = _paras_from_html(html)
    # Drop signature-like lines starting with an em-dash (source attribution).
    paras = [p for p in paras if not p.lstrip().startswith(("——", "――", "—"))]
    sec = _split_sections(paras)
    lead_pairs = _pair_bilingual(sec["lead"])
    speech_pairs = _pair_bilingual(sec["重要讲话"])
    # 相关词汇 entries are alternating ZH/EN paragraphs, same shape as lead/speech.
    related_pairs = _pair_bilingual(sec["相关词汇"])

    return {
        "url": meta["url"],
        "date": meta["date"],
        "id": meta["id"],
        "title_pair": list(title_pair) if title_pair else None,
        "lead_pairs": [list(p) for p in lead_pairs],
        "speech_pairs": [list(p) for p in speech_pairs],
        "related_pairs": [list(p) for p in related_pairs],
    }

# ---------------------------------------------------------------------------
# 3. Main
# ---------------------------------------------------------------------------
def main():
    os.makedirs(OUTDIR, exist_ok=True)

    print(f"[1/3] Enumerating article URLs (cutoff >= {CUTOFF}) ...")
    articles = enumerate_urls(CUTOFF, max_pages=30)
    print(f"  -> {len(articles)} article URLs collected\n")

    # Save the URL list up-front so we can resume if needed
    with open(os.path.join(OUTDIR, "chinadaily_urls.txt"), "w", encoding="utf-8") as f:
        for a in articles:
            f.write(f"{a['date']}\t{a['id']}\t{a['url']}\t{a['title_hint']}\n")

    print(f"[2/3] Fetching {len(articles)} articles ...")
    parsed: List[Dict] = []
    fail = 0
    for i, meta in enumerate(articles, 1):
        try:
            r = SESSION.get(meta["url"], timeout=15)
            r.encoding = "utf-8"
            if r.status_code != 200:
                fail += 1; print(f"  [{i}/{len(articles)}] HTTP {r.status_code} {meta['url']}")
                continue
            parsed.append(parse_article(r.text, meta))
            if i % 25 == 0:
                print(f"  [{i}/{len(articles)}] ok")
        except Exception as e:
            fail += 1
            print(f"  [{i}/{len(articles)}] !! {e}")
        time.sleep(SLEEP_S)

    print(f"  -> parsed {len(parsed)} articles ({fail} failures)\n")

    print("[3/3] Building normalized outputs ...")
    vocab_map: Dict[str, Dict] = {}   # id -> entry (deduped)
    sentence_list: List[Dict] = []

    def add_vocab(zh: str, en: str, kind: str, url: str, date: str):
        if len(zh) < 2 or len(en) < 2: return
        if len(zh) > 200 or len(en) > 300: return
        key = hashlib.sha1(f"{zh.lower()}|||{en.lower()}".encode("utf-8")).hexdigest()[:16]
        if key not in vocab_map:
            vocab_map[key] = {
                "id": key, "zh": zh, "en": en,
                "kind": kind, "source": "chinadaily-daily-word",
                "urls": [url], "dates": [date],
            }
        else:
            if url not in vocab_map[key]["urls"]:
                vocab_map[key]["urls"].append(url)
                vocab_map[key]["dates"].append(date)

    for a in parsed:
        if a["title_pair"]:
            add_vocab(*a["title_pair"], "term", a["url"], a["date"])
        for zh, en in a["related_pairs"]:
            add_vocab(zh, en, "term", a["url"], a["date"])
        for zh, en in a["lead_pairs"] + a["speech_pairs"]:
            if len(en.split()) >= 5 or len(zh) >= 10:
                sentence_list.append({
                    "zh": zh, "en": en,
                    "source": "chinadaily-daily-word",
                    "url": a["url"], "date": a["date"],
                    "kind": "speech" if (zh, en) in [tuple(p) for p in a["speech_pairs"]] else "lead",
                })

    vocab_list = sorted(vocab_map.values(), key=lambda e: e["en"].lower())

    with open(os.path.join(OUTDIR, "chinadaily_vocab.json"), "w", encoding="utf-8") as f:
        json.dump(vocab_list, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUTDIR, "chinadaily_sentences.json"), "w", encoding="utf-8") as f:
        json.dump(sentence_list, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUTDIR, "chinadaily_articles.json"), "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=1)

    print(f"\n[done]")
    print(f"  vocab terms: {len(vocab_list)}")
    print(f"  sentences:   {len(sentence_list)}")
    print(f"  articles:    {len(parsed)}")
    print(f"  -> {OUTDIR}\\chinadaily_vocab.json / chinadaily_sentences.json / chinadaily_articles.json")

if __name__ == "__main__":
    main()
