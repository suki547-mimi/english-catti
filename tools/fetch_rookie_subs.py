"""Fetch The Rookie subtitles from OpenSubtitles.com.

Given API key at data/opensubtitles_key.txt, downloads:
  data/subs/rookie/en/s01e01.srt (best English closed captions)
  data/subs/rookie/zh/s01e01.srt (best Chinese, falls back zh-TW if no zh-CN)

Resume-safe: skips episodes where both files already exist.
Polite: 1.5s delay between API calls.
"""
from __future__ import annotations
import json
import re
import sys
import time
from pathlib import Path
import urllib.request
import urllib.parse
import urllib.error

ROOT = Path(r"C:\Cursorworkspace\English")
KEY_PATH = ROOT / "data" / "opensubtitles_key.txt"
TOKEN_PATH = ROOT / "data" / "opensubtitles_token.txt"
OUT = ROOT / "data" / "subs" / "rookie"
API = "https://api.opensubtitles.com/api/v1"
USER_AGENT = "english-catti/0.5 (personal)"
SLEEP = 1.5

# Adjust as needed. S1 has 20 episodes; S2 has 20; S3 has 14.
SEASON = 1
EPISODES = range(1, 21)


def _headers(api_key: str, token: str | None = None) -> dict:
    h = {
        "Api-Key": api_key,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _get_json(url: str, api_key: str, token: str | None = None) -> dict:
    req = urllib.request.Request(url, headers=_headers(api_key, token))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _post_json(url: str, api_key: str, body: dict, token: str | None = None) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=_headers(api_key, token), method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.read())


def search(api_key: str, season: int, episode: int, langs: str) -> list[dict]:
    q = urllib.parse.urlencode({
        "query": "The Rookie",
        "type": "episode",
        "season_number": season,
        "episode_number": episode,
        "languages": langs,
    })
    try:
        r = _get_json(f"{API}/subtitles?{q}", api_key)
    except urllib.error.HTTPError as e:
        print(f"    search error: HTTP {e.code}: {e.read().decode(errors='replace')[:200]}")
        return []
    return r.get("data", []) or []


def pick_best(hits: list[dict]) -> dict | None:
    # Prefer highest downloads, then DVD/HI-tagged files.
    def score(hit):
        a = hit.get("attributes", {})
        dc = int(a.get("download_count") or 0)
        files = a.get("files", []) or []
        fn = (files[0].get("file_name") if files else "") or ""
        bonus = 0
        if "DVD" in fn.upper():
            bonus += 5000
        if ".HI." in fn or ".cc." in fn:
            bonus += 3000
        return dc + bonus

    return max(hits, key=score) if hits else None


def download_srt(api_key: str, file_id: int, dest: Path, token: str | None) -> bool:
    try:
        r = _post_json(f"{API}/download", api_key, {"file_id": file_id}, token=token)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors='replace')
        print(f"    download-request error HTTP {e.code}")
        print(f"    body (first 800): {body[:800]}")
        print(f"    resp headers: {dict(e.headers)}")
        return False
    link = r.get("link")
    remaining = r.get("remaining")
    if remaining is not None:
        print(f"    quota remaining: {remaining}")
    if not link:
        print(f"    no link in response: {r}")
        return False
    try:
        _download(link, dest)
    except Exception as e:
        print(f"    fetch error: {type(e).__name__}: {e}")
        return False
    return True


def episode_key(s: int, e: int) -> str:
    return f"s{s:02d}e{e:02d}"


def main():
    if not KEY_PATH.exists():
        print(f"Missing {KEY_PATH}")
        sys.exit(1)
    api_key = KEY_PATH.read_text(encoding="utf-8").strip()
    token = TOKEN_PATH.read_text(encoding="utf-8").strip() if TOKEN_PATH.exists() else None
    print(f"Auth: api_key ok + {'token' if token else 'NO TOKEN (downloads may 503)'}")
    (OUT / "en").mkdir(parents=True, exist_ok=True)
    (OUT / "zh").mkdir(parents=True, exist_ok=True)

    for ep in EPISODES:
        key = episode_key(SEASON, ep)
        en_path = OUT / "en" / f"{key}.srt"
        zh_path = OUT / "zh" / f"{key}.srt"
        print(f"\n=== S{SEASON:02d}E{ep:02d} ===")
        # English
        if en_path.exists() and en_path.stat().st_size > 500:
            print(f"  EN: already have {en_path.name}")
        else:
            hits = search(api_key, SEASON, ep, "en")
            time.sleep(SLEEP)
            best = pick_best(hits)
            if not best:
                print("  EN: no candidate found")
            else:
                files = best.get("attributes", {}).get("files", []) or []
                if not files:
                    print("  EN: candidate has no files")
                else:
                    fid = files[0].get("file_id")
                    print(f"  EN: fid={fid} · file={files[0].get('file_name')}")
                    if download_srt(api_key, fid, en_path, token):
                        print(f"  EN: saved {en_path.name} ({en_path.stat().st_size} bytes)")
            time.sleep(SLEEP)
        # Chinese (any zh variant)
        if zh_path.exists() and zh_path.stat().st_size > 500:
            print(f"  ZH: already have {zh_path.name}")
        else:
            hits = search(api_key, SEASON, ep, "zh-CN,zh-TW,zh")
            time.sleep(SLEEP)
            best = pick_best(hits)
            if not best:
                print("  ZH: no candidate found")
            else:
                files = best.get("attributes", {}).get("files", []) or []
                if not files:
                    print("  ZH: candidate has no files")
                else:
                    fid = files[0].get("file_id")
                    lang = best.get("attributes", {}).get("language")
                    print(f"  ZH ({lang}): fid={fid} · file={files[0].get('file_name')}")
                    if download_srt(api_key, fid, zh_path, token):
                        print(f"  ZH: saved {zh_path.name} ({zh_path.stat().st_size} bytes)")
            time.sleep(SLEEP)


if __name__ == "__main__":
    main()
