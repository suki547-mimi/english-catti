import json, random
v = json.load(open(r'C:\Cursorworkspace\English\data\vocab.json', 'r', encoding='utf-8'))
print(f'Total: {len(v)}\n')

# Show samples across letters
print('=== Random 20 samples ===')
for e in random.sample(v, 20):
    print(f'  [{e["letter"]}] {e["headword"]:<20} | {e["zh"][:25]:<25} -> {e["en"][:60]}')

# Show entries per letter head
print('\n=== First 3 per letter A/M/P/S ===')
by_letter = {}
for e in v:
    by_letter.setdefault(e['letter'], []).append(e)
for L in ['A','M','P','S']:
    print(f'--- {L} ---')
    for e in by_letter.get(L, [])[:3]:
        print(f'  {e["zh"]}  ->  {e["en"]}   (topic={e["topic"]})')

# Quality checks
print('\n=== Suspicious short entries ===')
short = [e for e in v if len(e['zh']) < 3 or len(e['en']) < 3]
print(f'  count: {len(short)}')
for e in short[:5]:
    print(f'  {e["zh"]}  ->  {e["en"]}')

print('\n=== Overly long ===')
lng = [e for e in v if len(e['en']) > 150]
print(f'  count: {len(lng)}')
for e in lng[:5]:
    print(f'  {e["zh"][:40]}  ->  {e["en"][:100]}...')

# Check headword extraction quality
print('\n=== Empty headwords ===')
empty = [e for e in v if not e['headword']]
print(f'  count: {len(empty)}')
for e in empty[:5]:
    print(f'  {e["zh"]}  ->  {e["en"]}')

# Sentence corpus
s = json.load(open(r'C:\Cursorworkspace\English\data\corpus_sentences.json', 'r', encoding='utf-8'))
print(f'\n=== Sentences: {len(s)} ===')
for i in [0, 20, 50, 90]:
    if i < len(s):
        print(f'  ZH: {s[i]["zh"][:80]}')
        print(f'  EN: {s[i]["en"][:80]}')
        print()
