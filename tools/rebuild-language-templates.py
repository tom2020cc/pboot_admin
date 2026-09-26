"""Rebuild local language templates from CN using reviewed translation dictionaries."""
import json
import re
import argparse
import sqlite3
from pathlib import Path
from html.parser import HTMLParser
from difflib import SequenceMatcher

ROOT = Path('E:/phpstudy_pro/WWW/shanbo-rig.c/template')
LANGS = ['en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'vi', 'tr']
HAN = re.compile(r'[\u3400-\u9fff]')
WS = lambda s: re.sub(r'\s+', ' ', s).strip()

class Units(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.events = []
        self.context = ''
        self.script = False
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.context = tag + ':' + (attrs.get('class') or attrs.get('id') or '')
        self.events.append(('tag:' + tag, None))
        for key in ['title', 'alt', 'placeholder', 'aria-label']:
            if attrs.get(key):
                self.events.append(('attr:' + tag + ':' + key, WS(attrs[key])))
        if attrs.get('oninvalid'):
            self.strings(attrs['oninvalid'], 'invalid')
        self.script = tag in ('script', 'style')

    def handle_endtag(self, tag):
        self.events.append(('end:' + tag, None))
        if tag in ('script', 'style'):
            self.script = False

    def handle_data(self, data):
        if self.script:
            self.strings(data, 'js')
        elif WS(data):
            data = re.sub(r'\{(?:/?pboot:[^}]+|include[^}]+)\}', '', data)
            if WS(data):
                self.events.append(('text', WS(data)))

    def strings(self, data, prefix):
        data = re.sub(r'/\*[\s\S]*?\*/|(?m:^\s*//[^\n]*)', '', data)
        for m in re.finditer(r"(['\"])((?:\\.|(?!\1)[^\\\r\n])*)\1", data):
            self.events.append((prefix, m[2]))

def extract():
    files = sorted((ROOT / 'cn/html').rglob('*.html'))
    maps = {lang: {} for lang in LANGS}
    missing = {}
    for file in files:
        rel = file.relative_to(ROOT / 'cn/html')
        a = Units(file.read_text(encoding='utf-8')).events
        for lang in LANGS:
            old = ROOT / lang / 'html' / rel
            b = Units(old.read_text(encoding='utf-8')).events
            common = {x[1] for x in a if x[1]} & {x[1] for x in b if x[1]}
            key = lambda x: x[0] + (':' + x[1] if x[1] in common else '')
            matcher = SequenceMatcher(None, list(map(key, a)), list(map(key, b)), autojunk=False)
            for match in matcher.get_matching_blocks():
                for j in range(match.size):
                    src, dst = a[match.a+j][1], b[match.b+j][1]
                    if src and dst and HAN.search(src) and not HAN.search(dst):
                        maps[lang].setdefault(src, dst)
    required = set()
    for file in files:
        for _, value in Units(file.read_text(encoding='utf-8')).events:
            if value and HAN.search(value): required.add(value)
    for lang in LANGS:
        missing[lang] = sorted(required - maps[lang].keys())
    target = Path(__file__).with_name('language-template-translations.json')
    target.write_text(json.dumps(maps, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'english': maps['en'], 'missing': missing}, ensure_ascii=False, indent=2))

def rebuild(write=False):
    maps = json.loads(Path(__file__).with_name('language-template-translations.json').read_text(encoding='utf-8'))
    dbpath = ROOT.parent / 'data/1412def6361bfd54fd4f519f81ba2d22.db'
    db = sqlite3.connect(dbpath.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    sorts = [dict(row) for row in db.execute('select acode,scode,filename from ay_content_sort')]
    db.close()
    source = ROOT / 'cn/html'
    files = sorted(source.rglob('*.html'))
    normalize = lambda s: re.sub(r'^(cn|en|es|fr|ar|pt|ru|id|vi|tr)-', '', s.lower())
    pending = []
    for lang in LANGS:
        mapping = {}
        for row in sorts:
            if row['acode'] != 'cn': continue
            candidates = [r for r in sorts if r['acode'] == lang and normalize(r['filename']) == normalize(row['filename'])]
            if len(candidates) == 1: mapping[str(row['scode'])] = str(candidates[0]['scode'])
        translations = maps[lang]
        keys = sorted(translations, key=len, reverse=True)
        for file in files:
            text = file.read_text(encoding='utf-8')
            if file.relative_to(source).as_posix() == 'comm/page.html':
                # Render translated pagination on the server, including empty states.
                text = (ROOT / 'comm/page.html').read_text(encoding='utf-8')
                text = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
            # Comments are implementation notes, not page copy.
            text = re.sub(r'<!--.*?-->|/\*.*?\*/|(?m:^\s*//[^\n]*)', '', text, flags=re.S)
            text = re.sub(r'(?<=\s)//[^\n]*', '', text)
            for key in keys:
                pattern = r'\s+'.join(re.escape(part) for part in key.split())
                if pattern:
                    text = re.sub(pattern, lambda _: translations[key], text)
            text = re.sub(r'\b(scode|parent)=(\d+)', lambda m: m[1] + '=' + (mapping[m[2]] if m[2] != '0' else '0'), text)
            text = text.replace("{pboot:position separator='>'}", "{pboot:position separator='>' indextext='" + translations['首页'] + "'}")
            if file.name == 'top.html':
                text = text.replace('lang="zh-CN"', 'lang="' + lang + '"' + (' dir="ltr"' if lang == 'ar' else ''))
                text = text.replace('</head>', '<link rel="stylesheet" href="/template/comm/localized-layout.css?v=20260922-cn">\n</head>')
            # PB generates language-specific links; no production domains are rewritten.
            leftovers = [line.strip() for line in text.splitlines() if HAN.search(line)]
            if leftovers:
                raise ValueError(f'{lang}/{file.relative_to(source)} has untranslated text: {leftovers}')
            target = ROOT / lang / 'html' / file.relative_to(source)
            assert target.resolve().is_relative_to((ROOT / lang / 'html').resolve())
            pending.append((target, text))
    print(f'Validated {len(pending)} templates across {len(LANGS)} languages.')
    if not write: return
    # Remove only the explicitly scoped old HTML templates after all replacements validate.
    for lang in LANGS:
        target = (ROOT / lang / 'html').resolve()
        assert target.is_relative_to(ROOT.resolve()) and lang != 'cn'
        for old in target.rglob('*.html'):
            assert old.resolve().is_relative_to(target)
            old.unlink()
    for target, text in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8', newline='\n')
    print('Replaced the old language HTML templates with the validated CN-based templates.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract-legacy', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.extract_legacy: extract()
    else: rebuild(args.write)
