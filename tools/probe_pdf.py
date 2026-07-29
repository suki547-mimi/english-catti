"""Investigate the CATTI PDF - is it text-based or scanned?"""
import fitz, os
p = r'C:\Cursorworkspace\English\Files\CATTI 英语二级翻译口笔译考试大纲词汇.pdf'
d = fitz.open(p)
print(f'pages: {len(d)}')
for i in [0, 1, 2, 5, 10, 50, 100, len(d)-1]:
    if i >= len(d): continue
    pg = d[i]
    txt = pg.get_text("text")
    imgs = pg.get_images()
    print(f'--- page {i}: chars={len(txt)}, images={len(imgs)} ---')
    print(txt[:400].replace('\n', ' \\n '))
    print()
