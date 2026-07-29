"""Parse Anki .apkg deck into structured JSON.

apkg = zip file containing:
  - collection.anki2 or collection.anki21  (SQLite DB)
  - media (JSON mapping)
  - <numeric filenames>  (audio/images)
"""
from __future__ import annotations
import os, sys, json, zipfile, sqlite3, tempfile, shutil, re, html
from typing import List, Dict

SRC = r'C:\Cursorworkspace\English\Files\翻硕-张培基散文合辑.apkg'
OUT = r'C:\Cursorworkspace\English\data\external\zhangpeiji_anki.json'
MEDIA_DIR = r'C:\Cursorworkspace\English\data\external\zhangpeiji_media'

os.makedirs(os.path.dirname(OUT), exist_ok=True)

with tempfile.TemporaryDirectory() as tmp:
    with zipfile.ZipFile(SRC, 'r') as zf:
        print("Files in .apkg:")
        for n in zf.namelist():
            print(f"  {n}")
        zf.extractall(tmp)

    # Find the sqlite DB
    db_path = None
    for candidate in ('collection.anki21', 'collection.anki2'):
        p = os.path.join(tmp, candidate)
        if os.path.exists(p):
            db_path = p; break
    if not db_path:
        # Look at all files
        for f in os.listdir(tmp):
            print(" tmp file:", f, os.path.getsize(os.path.join(tmp, f)))
        raise SystemExit("No collection db found")

    print(f"\nUsing DB: {os.path.basename(db_path)}")
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    # notes table: id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
    # flds = fields separated by \x1f (0x1F). Model determines what each field is.
    rows = con.execute("SELECT id, guid, mid, tags, flds FROM notes").fetchall()
    print(f"Notes: {len(rows)}")
    if rows:
        first = rows[0]
        print(f"\nSample fld[0]:")
        parts = first['flds'].split('\x1f')
        for i, p in enumerate(parts):
            preview = re.sub(r'<[^>]+>', '', p)[:200]
            print(f"  [{i}] {preview}")
        print(f"  tags: {first['tags']!r}")

    # Models: fetch model definitions
    models_row = con.execute("SELECT models FROM col").fetchone()
    if models_row:
        try:
            models = json.loads(models_row[0])
            print(f"\nModels: {len(models)}")
            for mid, mdef in models.items():
                fields = [f['name'] for f in mdef.get('flds', [])]
                print(f"  {mid}: name={mdef.get('name')!r}, fields={fields}")
        except Exception as e:
            print(f"  model parse err: {e}")

    # Convert all notes -> structured list
    notes = []
    for r in rows:
        flds = r['flds'].split('\x1f')
        # Strip HTML for readable text but keep original too
        plain = [re.sub(r'<[^>]+>', ' ', html.unescape(f)).strip() for f in flds]
        notes.append({
            "id": r['id'],
            "guid": r['guid'],
            "mid": r['mid'],
            "tags": r['tags'].strip().split() if r['tags'].strip() else [],
            "fields": flds,
            "fields_plain": plain,
        })

    con.close()

    # Copy media into workspace (only if small)
    media_json = os.path.join(tmp, 'media')
    if os.path.exists(media_json):
        with open(media_json, 'r', encoding='utf-8') as f:
            media_map = json.load(f)
        print(f"\nMedia files: {len(media_map)}")
        # Media file names in the zip are the KEYS (0, 1, 2...); values are original names
        # Copy first few to media dir
        # (For 7.7 MB deck this could be images/audio - copy if under 20 MB total)
        # os.makedirs(MEDIA_DIR, exist_ok=True)
        # for numeric, original in list(media_map.items())[:5]:
        #     src = os.path.join(tmp, numeric)
        #     if os.path.exists(src):
        #         shutil.copy2(src, os.path.join(MEDIA_DIR, original))

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(notes, f, ensure_ascii=False, indent=1)

print(f"\nWrote {OUT}  ({len(notes)} notes)")
