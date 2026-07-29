import json
r = json.load(open(r'C:\Cursorworkspace\English\tools\sample_report.json', 'r', encoding='utf-8'))
print(f'Total files: {len(r)}\n')
print(f'{"file":<70} {"lines":>7} {"en":>6} {"zh":>6} {"mix":>6}')
print('-' * 100)
for e in r:
    name = e['file'][:68]
    if 'error' in e:
        print(f'{name:<70} ERR: {e["error"][:40]}')
    else:
        print(f'{name:<70} {e["lines"]:>7} {e["lines_with_en"]:>6} {e["lines_with_zh"]:>6} {e["lines_mixed_en_zh"]:>6}')

print()
for e in r:
    if e['file'].startswith('CATTI') or e['file'].startswith('202009'):
        print('=== ' + e['file'] + ' ===')
        for h in e.get('head', [])[:12]:
            print(' HEAD:', repr(h)[:250])
        print()
