"""Targeted multilingual content corrections; no CN rows or schema changes."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import sqlite3

LANGS = ['en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'vi', 'tr']
REPLACEMENTS = {
    'en': {'装车宽度 / Width of loading': 'Width of loading', '山东省济宁市': 'Jining, Shandong, China'},
    'ar': {
        'بنمطي عمل更适合 مطابقة': 'بنمطي عمل أكثر ملاءمة لمطابقة',
        'القطر الأكبر有利于 تركيب': 'يساعد القطر الأكبر على تركيب',
        'SCGC-200kW柴油发电机组': 'SCGC-200kW (مجموعة مولد ديزل)',
        '90 kW电机': '90 kW (محرك كهربائي)',
        '11 kW电机': '11 kW (محرك كهربائي)',
        '1.6 متر،可以帮助 المعدات على': '1.6 متر، مما يساعد المعدات على',
    },
    'vi': {'tháp伸缩': 'tháp ống lồng', 'Tháp伸缩': 'Tháp ống lồng'},
    'ru': {
        'раствор主要用于 охлаждение и вынос шлама': 'раствор используется преимущественно для охлаждения и выноса шлама',
        '持续增储 (постоянного прироста запасов)': 'постоянного прироста запасов',
        'для规格 NTW': 'для типоразмера NTW',
        '一般 неровн': ' умеренно неровн',
        '一般 принадлежностей': ' стандартных принадлежностей',
        'Сельское, коммунальное, промышленное и一般 разработка подземных вод': 'Разработка подземных вод для сельских районов, коммунального и промышленного водоснабжения и других нужд',
        '特定 предварительного': ' специального предварительного',
        '特定 целей': ' конкретных целей',
        '正式 геотермальных': ' промышленных геотермальных',
        '正式 проекте': ' реальном проекте',
        'перед正式 началом': 'перед началом',
        'Перед正式 строительством': 'Перед началом работ',
        '局部 заклинивание': ' локальное заклинивание',
        'следует配置': 'следует подбирать',
        'много配套 инструментов': 'много вспомогательных инструментов',
        'заранее确认': 'заранее проверить',
        '常用 диапазона': ' типового диапазона',
        'такой компактный корпус легче заходит и调整 положение скважины': 'компактные размеры облегчают размещение машины и выбор положения скважины',
        'в первую очередь考虑': 'в первую очередь предусматривать',
        'проект长期 связан': 'проект постоянно связан',
        'пену для辅助': 'пену в качестве вспомогательного средства',
        'пенную辅助': 'применение пены',
        '部分 крупных проектах': ' некоторых крупных проектах',
        'для部分 проектов': 'для некоторых проектов',
        'помогают减少': 'помогают сократить',
        '集中но': ' скоплениями',
        '集中': ' скоплениями',
        '3NB-130用于': '3NB-130 для',
    },
}

def fix_content(lang, value):
    text = value or ''
    for old, new in REPLACEMENTS.get(lang, {}).items():
        text = text.replace(old, new)
    # The fifth CR1200I photo does not exist; retain the four actual photos.
    text = re.sub(r'<img\b[^>]*\bsrc=["\'][^"\']*/CR1200I/05\.jpg["\'][^>]*>', '', text, flags=re.I)
    # Windows accepted the wrong case, but the production Linux filesystem does not.
    text = re.sub(r'(/CR1600I/(?:00|04))\.JPG', r'\1.jpg', text)
    return text

def cn_digest(db):
    data = {table: [dict(r) for r in db.execute('SELECT * FROM ' + table + " WHERE acode='cn' ORDER BY id")]
            for table in ['ay_content', 'ay_content_sort', 'ay_site', 'ay_company']}
    data['ay_content_ext'] = [dict(r) for r in db.execute("SELECT e.* FROM ay_content_ext e JOIN ay_content c ON c.id=e.contentid WHERE c.acode='cn' ORDER BY e.contentid")]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

def repair(dbpath, pages=None, apply=False):
    db = sqlite3.connect(str(dbpath) if apply else 'file:' + str(dbpath) + '?mode=ro', uri=not apply)
    db.row_factory = sqlite3.Row
    before = cn_digest(db)
    changes, remaining = [], []
    with db:
        for row in db.execute("SELECT id,acode,title,content FROM ay_content WHERE acode!='cn'").fetchall():
            if row['acode'] not in LANGS:
                continue
            old = row['content'] or ''
            new = fix_content(row['acode'], old)
            if old != new:
                changes.append({'type': 'content', 'lang': row['acode'], 'title': row['title']})
                if apply:
                    db.execute('UPDATE ay_content SET content=? WHERE id=? AND acode=? AND content=?', (new, row['id'], row['acode'], row['content']))
            visible = html.unescape(re.sub('<[^>]+>', ' ', new))
            han = re.findall('[\u3400-\u9fff]+', visible)
            if han:
                remaining.append({'lang': row['acode'], 'title': row['title'], 'text': han})
        for row in db.execute("SELECT e.contentid,e.ext_cp_BigPic,c.acode FROM ay_content_ext e JOIN ay_content c ON c.id=e.contentid WHERE c.acode!='cn'").fetchall():
            old = row['ext_cp_BigPic'] or ''
            new = re.sub(r'(/CR1600I/(?:00|04))\.JPG', r'\1.jpg', old)
            if row['acode'] in LANGS and new != old:
                changes.append({'type': 'detail-image', 'lang': row['acode']})
                if apply:
                    db.execute('UPDATE ay_content_ext SET ext_cp_BigPic=? WHERE contentid=? AND ext_cp_BigPic=?', (new, row['contentid'], old))
        for table, field, old, new in [
            ('ay_site', 'title', '恒建行钻机 ', 'Буровые установки Hengjianhang'),
            ('ay_company', 'name', '山东恒健行工程机械有限公司', 'Shandong Hengjianhang Construction Machinery Co., Ltd.'),
        ]:
            row = db.execute('SELECT ' + field + ' FROM ' + table + " WHERE acode='ru'").fetchone()
            if row and row[field].strip() == old.strip():
                changes.append({'type': table + '.' + field, 'lang': 'ru'})
                if apply:
                    db.execute('UPDATE ' + table + ' SET ' + field + "=? WHERE acode='ru' AND " + field + '=?', (new, row[field]))
        for page in pages or []:
            if page['acode'] not in LANGS or page['acode'] == 'en':
                raise ValueError('Unexpected language in missing-page import')
            source_scode = page['scode']
            category = db.execute('SELECT acode,mcode FROM ay_content_sort WHERE scode=?', (source_scode,)).fetchone()
            if not category or category['acode'] != page['acode'] or str(category['mcode']) != '1':
                raise ValueError('Single-page category mismatch')
            existing = db.execute('SELECT id FROM ay_content WHERE scode=?', (source_scode,)).fetchall()
            if existing:
                continue
            data = {k:v for k,v in page.items() if k != 'id'}
            changes.append({'type': 'missing-page', 'lang': page['acode'], 'title': page['title']})
            if apply:
                fields = list(data)
                db.execute('INSERT INTO ay_content (' + ','.join(fields) + ') VALUES (' + ','.join('?' for _ in fields) + ')', [data[k] for k in fields])
        if cn_digest(db) != before:
            raise RuntimeError('CN data changed unexpectedly')
    db.close()
    return {'applied': apply, 'changes': changes, 'remainingChinese': remaining, 'cnUnchanged': True}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--pages', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    pages = json.loads(args.pages.read_text(encoding='utf-8')) if args.pages else None
    print(json.dumps(repair(args.database, pages, args.apply), ensure_ascii=False, indent=2))
