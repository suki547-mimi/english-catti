"""Morning status check — run this to see what happened overnight."""
import os, json, subprocess, time

ROOT = r'C:\Cursorworkspace\English'
print("=" * 66)
print("  English CATTI project — morning status check")
print("=" * 66)

# --- 1. Data files ---
print("\n[1] Data files")
for name in ['unified_vocab.json', 'unified_sentences.json', 'audio_index.json',
             'chinadaily_vocab.json', 'chinadaily_sentences.json',
             'mfa_dialog_pairs.json', 'catti3_vocab.json',
             'zhangpeiji_pairs.json']:
    fp = os.path.join(ROOT, 'data', name)
    if os.path.exists(fp):
        size = os.path.getsize(fp)
        print(f"  {name:35}  {size/1024:8.1f} KB")

# --- 2. Vocab stats ---
print("\n[2] Vocab stats")
vocab = json.load(open(os.path.join(ROOT, 'data', 'unified_vocab.json'), 'r', encoding='utf-8'))
sentences = json.load(open(os.path.join(ROOT, 'data', 'unified_sentences.json'), 'r', encoding='utf-8'))
print(f"  Total entries:        {len(vocab)}")
print(f"  Unique headwords:     {len(set(v.get('headword','') for v in vocab if v.get('headword')))}")
print(f"  With Chinese meaning: {sum(1 for v in vocab if v.get('zh'))}")
print(f"  Bilingual sentences:  {len(sentences)}")

# --- 3. Audio ---
print("\n[3] Audio generation")
audio_us = os.path.join(ROOT, 'data', 'audio', 'us')
audio_uk = os.path.join(ROOT, 'data', 'audio', 'uk')
if os.path.exists(audio_us):
    us_count = sum(1 for f in os.listdir(audio_us) if f.endswith('.mp3'))
    uk_count = sum(1 for f in os.listdir(audio_uk) if f.endswith('.mp3')) if os.path.exists(audio_uk) else 0
    audio_idx = json.load(open(os.path.join(ROOT, 'data', 'audio_index.json'), 'r', encoding='utf-8'))
    target = len(audio_idx)
    total_files = us_count + uk_count
    total_target = target * 2
    pct = 100.0 * total_files / total_target if total_target else 0
    print(f"  US files:  {us_count:6}  ({100.0*us_count/target:.1f}%)")
    print(f"  UK files:  {uk_count:6}  ({100.0*uk_count/target:.1f}%)")
    print(f"  Total:     {total_files:6} / {total_target}  ({pct:.1f}%)")
    # Estimate audio dir size
    total_bytes = 0
    for d in [audio_us, audio_uk]:
        if os.path.exists(d):
            for f in os.listdir(d):
                total_bytes += os.path.getsize(os.path.join(d, f))
    print(f"  Total size: {total_bytes/1024/1024:.1f} MB")
    if pct >= 99.9:
        print("  ✅ Audio generation COMPLETE!")
    else:
        remaining = total_target - total_files
        print(f"  ⏳ Still running: {remaining} files remaining")
else:
    print("  no audio directory")

# --- 4. VS Code extension ---
print("\n[4] VS Code extension")
ext_root = os.path.join(ROOT, 'english-extension')
if os.path.exists(ext_root):
    print(f"  Extension dir exists: {ext_root}")
    for name in ['package.json', 'tsconfig.json', 'src/extension.ts',
                 'src/panel.ts', 'src/lm.ts',
                 'webview/index.html', 'webview/main.js', 'webview/styles.css',
                 'README.md']:
        fp = os.path.join(ext_root, name.replace('/', os.sep))
        marker = '✓' if os.path.exists(fp) else '✗'
        print(f"    [{marker}] {name}")
    node_modules = os.path.join(ext_root, 'node_modules')
    out_dir = os.path.join(ext_root, 'out')
    print(f"    npm install run: {'YES' if os.path.exists(node_modules) else 'NO — run `npm install` first'}")
    print(f"    Compiled:        {'YES' if os.path.exists(out_dir) else 'NO — run `npm run compile` after install'}")
else:
    print("  no extension directory")

# --- 5. Git status ---
print("\n[5] Git status")
env = os.environ.copy()
env['Path'] = os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'Git', 'cmd') + os.pathsep + env.get('Path', '')
res = subprocess.run(['git', '-C', ROOT, 'log', '--oneline', '-5'], capture_output=True, text=True, env=env)
print(res.stdout or res.stderr)
res = subprocess.run(['git', '-C', ROOT, 'status', '--short'], capture_output=True, text=True, env=env)
uncommitted = res.stdout.strip()
if uncommitted:
    print(f"  uncommitted changes: {len(uncommitted.splitlines())} files")
else:
    print("  ✅ working tree clean")

print("\nDone.")
