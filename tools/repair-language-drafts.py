"""Repair reviewed foreign-language draft text while management DB writers are stopped.

Dry-run by default. Uses exactly the same reviewed replacements as the PB repair.
Does not publish, import whole tables, change schemas, or touch CN/shared fields.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sqlite3
import uuid


def repair(database, apply=False, content=None):
    if content is None:
        spec = importlib.util.spec_from_file_location('content_repair', Path(__file__).with_name('repair-language-content.py'))
        content = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(content)
    db = sqlite3.connect('file:' + str(Path(database).resolve()) + ('?mode=rw' if apply else '?mode=ro'), uri=True)
    db.row_factory = sqlite3.Row
    site = db.execute("SELECT id FROM managed_sites WHERE code='shanbo-rig-com'").fetchall()
    if len(site) != 1:
        raise ValueError('Expected exactly one shanbo-rig-com site')
    changes = []
    with db:
        for row in db.execute('SELECT t.* FROM product_translations t JOIN product p ON p.id=t.productId WHERE p.siteId=?', (site[0]['id'],)).fetchall():
            if row['lang'] not in content.LANGS:
                continue
            new = content.fix_content(row['lang'], row['content'])
            if new != (row['content'] or ''):
                changes.append({'type': 'product', 'id': row['id'], 'language': row['lang']})
                if apply:
                    db.execute('UPDATE product_translations SET content=?,updateTime=CURRENT_TIMESTAMP WHERE id=? AND content=?', (new, row['id'], row['content']))
        for row in db.execute("SELECT * FROM site_information_draft WHERE siteId=? AND language='ru'", (site[0]['id'],)).fetchall():
            data = json.loads(row['data'])
            changed = []
            for section, field, old, new in [
                ('site', 'title', '恒建行钻机', 'Буровые установки Hengjianhang'),
                ('company', 'name', '山东恒健行工程机械有限公司', 'Shandong Hengjianhang Construction Machinery Co., Ltd.'),
            ]:
                if str(data.get(section, {}).get(field, '')).strip() == old:
                    data[section][field] = new
                    changed.append(section + '.' + field)
            if changed:
                changes.append({'type': 'site-information', 'language': 'ru', 'fields': changed})
                if apply:
                    # Retain baseRevision so unrelated PB changes still trigger conflict protection.
                    db.execute('UPDATE site_information_draft SET data=?,revision=? WHERE id=? AND data=?',
                               (json.dumps(data, ensure_ascii=False, separators=(',', ':')), str(uuid.uuid4()), row['id'], row['data']))
    db.close()
    return {'applied': apply, 'changes': changes}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--apply', action='store_true', help='Only use after stopping all management database writers')
    args = parser.parse_args()
    print(json.dumps(repair(args.database, args.apply), ensure_ascii=False))
