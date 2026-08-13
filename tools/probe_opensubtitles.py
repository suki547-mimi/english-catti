"""Verify OpenSubtitles API key works + probe The Rookie catalog.

Usage: python probe_opensubtitles.py
Reads key from data/opensubtitles_key.txt.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
import urllib.request
import urllib.parse

ROOT = Path(r"C:\Cursorworkspace\English")
KEY_PATH = ROOT / "data" / "opensubtitles_key.txt"
API = "https://api.opensubtitles.com/api/v1"


def _headers(api_key: str) -> dict:
    return {
        "Api-Key": api_key,
        "Content-Type": "application/json",
        # OpenSubtitles requires a User-Agent identifying the app + version.
        "User-Agent": "english-catti/0.5 (personal)",
    }


def http_get(url: str, api_key: str) -> dict:
    req = urllib.request.Request(url, headers=_headers(api_key))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    if not KEY_PATH.exists():
        print(f"Missing key file: {KEY_PATH}")
        sys.exit(1)
    api_key = KEY_PATH.read_text(encoding="utf-8").strip()
    print(f"Using API key: {api_key[:6]}…{api_key[-4:]} ({len(api_key)} chars)")

    print("\n[1/2] Search: The Rookie S01E01 (English)")
    q = urllib.parse.urlencode({
        "query": "The Rookie",
        "type": "episode",
        "season_number": 1,
        "episode_number": 1,
        "languages": "en",
    })
    try:
        data = http_get(f"{API}/subtitles?{q}", api_key)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")
        sys.exit(2)
    hits = data.get("data", [])
    total = data.get("total_count", len(hits))
    print(f"  results: {total} (showing top 3)")
    for item in hits[:3]:
        a = item.get("attributes", {})
        feat = a.get("feature_details", {}) or {}
        print(
            f"  · id={item.get('id')} · lang={a.get('language')} · "
            f"downloads={a.get('download_count')} · "
            f"{feat.get('title')} S{feat.get('season_number')}E{feat.get('episode_number')} "
            f"({feat.get('year')})"
        )
        files = a.get("files", []) or []
        for f in files[:1]:
            print(f"     file_id={f.get('file_id')} · {f.get('file_name')}")

    print("\n[2/2] Search: The Rookie S01E01 (Chinese)")
    q_cn = urllib.parse.urlencode({
        "query": "The Rookie",
        "type": "episode",
        "season_number": 1,
        "episode_number": 1,
        "languages": "zh-CN,zh-TW,zh",
    })
    data_cn = http_get(f"{API}/subtitles?{q_cn}", api_key)
    hits_cn = data_cn.get("data", [])
    print(f"  results: {data_cn.get('total_count', len(hits_cn))} (showing top 3)")
    for item in hits_cn[:3]:
        a = item.get("attributes", {})
        feat = a.get("feature_details", {}) or {}
        print(
            f"  · id={item.get('id')} · lang={a.get('language')} · "
            f"downloads={a.get('download_count')} · "
            f"{feat.get('title')} S{feat.get('season_number')}E{feat.get('episode_number')}"
        )
    print("\n✅ API key works." if hits else "\n⚠️ Key works but no English hit? Check show name.")


if __name__ == "__main__":
    main()
