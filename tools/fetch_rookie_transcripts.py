"""Scrape The Rookie transcripts from springfieldspringfield.co.uk.

Fetches all 144 episodes across 8 seasons. Extracts dialogue lines, strips
HTML/sound-cue clutter, and writes per-episode JSON files plus a combined
dialogue index. Resume-safe: skips episodes already saved.

Output layout:
  data/subs/rookie/en/s01e01.json      { title, url, lines: [str, ...] }
  data/subs/rookie/rookie_index.json   list of episode slugs seen
  data/subs/rookie/rookie_dialogues.json  flat merged file with all lines tagged

No auth needed. Site is free. Polite: 1.2s delay per request.
"""
from __future__ import annotations
import html
import json
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(r"C:\Cursorworkspace\English")
OUT = ROOT / "data" / "subs" / "rookie"
SHOW_SLUG = "the-rookie-2018"
INDEX_URL = f"https://www.springfieldspringfield.co.uk/episode_scripts.php?tv-show={SHOW_SLUG}"
EP_URL = f"https://www.springfieldspringfield.co.uk/view_episode_scripts.php?tv-show={SHOW_SLUG}&episode={{ep}}"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"
SLEEP = 1.2

# Anything wholly in brackets is a stage direction / sound cue — skip.
BRACKET_ONLY = re.compile(r"^\s*[\[\(][^\]\)]*[\]\)]\s*$")
BRACKET_INLINE = re.compile(r"[\[\(][^\]\)]{1,80}[\]\)]")
MULTI_WS = re.compile(r"\s+")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def list_episodes() -> list[str]:
    data = fetch(INDEX_URL)
    slugs = re.findall(rf"episode=(s\d{{2}}e\d{{2}})", data)
    return list(dict.fromkeys(slugs))


def extract_lines(html_body: str) -> tuple[str, list[str]]:
    """Return (title, lines) from an episode page."""
    title_m = re.search(r"<h1>([^<]+)</h1>", html_body)
    title = html.unescape(title_m.group(1)).strip() if title_m else ""

    # Match the exact opening tag; the string 'scrolling-script-container' also
    # appears in early CSS/JS which produced a false-positive earlier.
    open_re = re.compile(r'<div\s+class="scrolling-script-container"\s*>', re.I)
    m = open_re.search(html_body)
    if not m:
        return title, []
    start = m.end()
    end = html_body.find('</div>', start)
    body = html_body[start:end] if end > start else html_body[start:]
    raw = re.split(r"<br\s*/?>", body, flags=re.IGNORECASE)
    lines: list[str] = []
    for r in raw:
        r = re.sub(r"<[^>]+>", " ", r)
        r = html.unescape(r)
        r = MULTI_WS.sub(" ", r).strip()
        if not r:
            continue
        if len(r) <= 2 and r.isdigit():
            continue
        if BRACKET_ONLY.match(r):
            continue
        cleaned = BRACKET_INLINE.sub(" ", r)
        cleaned = MULTI_WS.sub(" ", cleaned).strip(" -.")
        if not cleaned or len(cleaned) < 3:
            continue
        lines.append(cleaned)
    return title, lines


def main():
    (OUT / "en").mkdir(parents=True, exist_ok=True)
    print(f"Fetching episode index from {INDEX_URL}")
    slugs = list_episodes()
    (OUT / "rookie_index.json").write_text(json.dumps(slugs, indent=2), encoding="utf-8")
    print(f"Found {len(slugs)} episode slugs")

    merged: list[dict] = []
    fresh_count = 0
    for i, slug in enumerate(slugs, 1):
        out_path = OUT / "en" / f"{slug}.json"
        if out_path.exists():
            data = json.loads(out_path.read_text(encoding="utf-8"))
            print(f"[{i:>3}/{len(slugs)}] {slug} cached ({len(data.get('lines', []))} lines)")
        else:
            url = EP_URL.format(ep=slug)
            try:
                body = fetch(url)
            except urllib.error.HTTPError as e:
                print(f"[{i:>3}/{len(slugs)}] {slug} HTTP {e.code}")
                time.sleep(SLEEP)
                continue
            title, lines = extract_lines(body)
            data = {"slug": slug, "title": title, "url": url, "lines": lines}
            out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            fresh_count += 1
            print(f"[{i:>3}/{len(slugs)}] {slug} saved ({len(lines)} lines) — {title[:60]}")
            time.sleep(SLEEP)
        for line in data.get("lines", []):
            merged.append({"episode": slug, "en": line})

    merged_path = OUT / "rookie_dialogues.json"
    merged_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nMerged {len(merged)} dialogue lines from {len(slugs)} episodes.")
    print(f"Fresh downloads this run: {fresh_count}")
    print(f"Output: {merged_path}")


if __name__ == "__main__":
    main()
