import requests, json
r = requests.get('https://api.github.com/repos/git-for-windows/git/releases/latest', timeout=15)
if r.status_code == 200:
    d = r.json()
    print('Latest version:', d['tag_name'])
    for a in d['assets']:
        n = a['name']
        if 'MinGit' in n and 'busybox' not in n.lower() and '64-bit' in n and n.endswith('.zip'):
            size_mb = a['size'] // 1024 // 1024
            print(f'  {n}  ({size_mb} MB)  -> {a["browser_download_url"]}')
else:
    print('HTTP', r.status_code)
