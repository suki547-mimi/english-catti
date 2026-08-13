"""Download YouTube audio clips of specific characters for RVC training.

RVC needs ~5-10 minutes of clean speech per character (single speaker, no music,
no other characters talking over). You provide a list of YouTube URLs + start/end
times, this script downloads the audio and cuts each clip.

Usage:
  1. Fill in CLIPS below with real timestamps you find on YouTube (search e.g.
     "John Nolan best scenes", "Lucy Chen interrogation").
  2. Install yt-dlp:  pip install yt-dlp
  3. Install ffmpeg system-wide (choco install ffmpeg on Windows).
  4. Run: python tools/rvc_download_clips.py

Output layout:
  data/rvc/raw/john/<clip>.wav
  data/rvc/raw/lucy/<clip>.wav
  ...
"""
from __future__ import annotations
import subprocess
from pathlib import Path

ROOT = Path(r"C:\Cursorworkspace\English")
OUT = ROOT / "data" / "rvc" / "raw"

# Fill in more entries (url + start + end + character). Aim for 5-10 min total
# per character across multiple clips. Prefer scenes where the character is the
# only one speaking (monologues, interrogations, radio calls).
CLIPS: list[dict] = [
    # {"character": "john", "url": "https://www.youtube.com/watch?v=XXXX", "start": "0:15", "end": "0:45", "clip_id": "1"},
    # {"character": "john", "url": "https://www.youtube.com/watch?v=YYYY", "start": "1:22", "end": "1:58", "clip_id": "2"},
    # {"character": "lucy", "url": "https://www.youtube.com/watch?v=ZZZZ", "start": "0:05", "end": "0:38", "clip_id": "1"},
]


def download_clip(clip: dict) -> None:
    character = clip["character"]
    url = clip["url"]
    start = clip["start"]
    end = clip["end"]
    clip_id = clip["clip_id"]

    out_dir = OUT / character
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{clip_id}.wav"
    if out_path.exists():
        print(f"  cached: {out_path}")
        return

    section = f"*{start}-{end}"
    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--download-sections", section,
        "--force-keyframes-at-cuts",
        "-o", str(out_path),
        url,
    ]
    print(f"  downloading {character}/{clip_id} {start}-{end}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  FAIL: {result.stderr[:200]}")
    else:
        print(f"  OK: {out_path}")


def main():
    if not CLIPS:
        print("!! No clips configured. Edit CLIPS at the top of this file first.")
        print("Recommended workflow:")
        print("  1. On YouTube, find scenes with a single character talking clearly")
        print("  2. Note the URL + start/end times")
        print("  3. Add entries here, then rerun")
        return
    for i, clip in enumerate(CLIPS, 1):
        print(f"[{i}/{len(CLIPS)}] {clip['character']} - {clip['clip_id']}")
        download_clip(clip)


if __name__ == "__main__":
    main()
