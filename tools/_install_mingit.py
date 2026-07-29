"""Download & install MinGit to %LOCALAPPDATA%\Programs\Git and add to user PATH."""
import os, sys, zipfile, io, tempfile, subprocess
import requests

MINGIT_URL = "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/MinGit-2.55.0.3-64-bit.zip"
INSTALL_DIR = os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'Git')

print(f"[1/4] Downloading MinGit... ({MINGIT_URL})")
r = requests.get(MINGIT_URL, timeout=180, stream=True)
r.raise_for_status()
buf = io.BytesIO()
total = 0
for chunk in r.iter_content(8192):
    buf.write(chunk); total += len(chunk)
buf.seek(0)
print(f"  downloaded {total/1024/1024:.1f} MB")

print(f"[2/4] Extracting to {INSTALL_DIR}")
os.makedirs(INSTALL_DIR, exist_ok=True)
with zipfile.ZipFile(buf) as zf:
    zf.extractall(INSTALL_DIR)

git_exe = os.path.join(INSTALL_DIR, 'cmd', 'git.exe')
if not os.path.exists(git_exe):
    # try mingw64
    git_exe = os.path.join(INSTALL_DIR, 'mingw64', 'bin', 'git.exe')
print(f"  git.exe at: {git_exe}")
print(f"  exists: {os.path.exists(git_exe)}")

print(f"[3/4] Add to user PATH (persistent)")
# Read current user PATH
p = subprocess.run(['powershell', '-NoProfile', '-Command',
                    "[Environment]::GetEnvironmentVariable('Path','User')"],
                   capture_output=True, text=True)
current_user_path = (p.stdout or '').strip()
git_cmd_dir = os.path.join(INSTALL_DIR, 'cmd')
if git_cmd_dir.lower() not in current_user_path.lower():
    new_path = current_user_path + (';' if current_user_path else '') + git_cmd_dir
    subprocess.run(['powershell', '-NoProfile', '-Command',
                    f"[Environment]::SetEnvironmentVariable('Path','{new_path}','User')"],
                   check=True)
    print(f"  added {git_cmd_dir} to user PATH")
else:
    print(f"  already in user PATH")

print(f"[4/4] Verify (running in fresh env)")
env = os.environ.copy()
env['Path'] = git_cmd_dir + ';' + env.get('Path', '')
res = subprocess.run([git_exe, '--version'], capture_output=True, text=True, env=env)
print(f"  {res.stdout.strip() or res.stderr.strip()}")

print(f"\nDone. Restart your shell to pick up PATH globally, OR use this session's git via full path:")
print(f"  {git_exe}")
