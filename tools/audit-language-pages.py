"""Read-only online PB template/content audit, executed on the site server."""
import base64
import concurrent.futures
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
import sqlite3
import urllib.parse
import urllib.request

ROOT = Path('/www/wwwroot/shanbo-rig.com')
LANGS = ['en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'vi', 'tr']

def check(lang, domain, route):
    url = 'https://' + domain + route
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Shanbo-Language-Audit/1.0'}), timeout=20) as r:
            body, status, final = r.read().decode('utf-8'), r.status, r.url
    except Exception as e:
        return {'route': route, 'issues': [str(e)[:150]]}, set()
    issues = []
    if status != 200 or final != url:
        issues.append('HTTP ' + str(status) + ' ' + final)
    actual = re.search(r'<html\b[^>]*\blang=["\']([^"\']+)', body, re.I)
    if not actual or actual[1] != lang:
        issues.append('Wrong HTML language')
    text = re.sub(r'<!--.*?-->|<(script|style)\b[^>]*>.*?</\1>', '', body, flags=re.S | re.I)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text)).replace('中文', '')
    han = list(dict.fromkeys(re.findall(r'[\u3400-\u9fff][\u3400-\u9fff\s，。、：；（）！？·-]*', text)))
    if han:
        issues.append('Chinese: ' + ' | '.join(han)[:350])
    if re.search(r'\{(?:pboot:|content:|sort:|include file)|Fatal error|Parse error', body):
        issues.append('Unparsed template / PHP error')
    for block in re.findall(r'<dl class="home-product-specs">(.*?)</dl>', body, re.S):
        if len(re.findall(r'<dd\b', block)) < 3:
            issues.append('Fewer than 3 product property rows')
    missing = []
    for src in re.findall(r'<img\b[^>]*\bsrc=["\']([^"\']+)', body, re.I):
        u = urllib.parse.urlparse(urllib.parse.urljoin(url, html.unescape(src)))
        if u.hostname == domain and u.path.startswith(('/static/', '/uploads/', '/template/')):
            p = (ROOT / urllib.parse.unquote(u.path).lstrip('/')).resolve()
            if p.is_relative_to(ROOT) and not p.is_file():
                missing.append(u.path)
    if missing:
        issues.append('Missing images: ' + ', '.join(sorted(set(missing)))[:250])
    links = set()
    for href in re.findall(r'href=["\']([^"\'#]+)', body, re.I):
        u = urllib.parse.urlparse(urllib.parse.urljoin(url, html.unescape(href)))
        if u.hostname == domain and not u.query and u.path.endswith('.html'):
            links.add(u.path)
    return {'route': route, 'status': status, 'issues': issues}, links

def run():
    db = sqlite3.connect('file:' + str(ROOT / 'data/20260922.db') + '?mode=ro', uri=True)
    sorts = list(db.execute('SELECT acode,filename FROM ay_content_sort WHERE status=1'))
    db.close()
    report = []
    for lang in LANGS:
        domain = 'shanbo-rig.com' if lang == 'en' else lang + '.shanbo-rig.com'
        pending = {'/'} | {'/' + f + '/' for a, f in sorts if a == lang and f}
        seen, rows = set(), []
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            while pending:
                batch = sorted(pending - seen)
                if not batch:
                    break
                seen.update(batch)
                pending = set()
                for row, links in pool.map(lambda route: check(lang, domain, route), batch):
                    rows.append(row)
                    pending.update(links - seen)
                if len(seen) > 250:
                    raise RuntimeError('Unexpected route count')
        failures = [r for r in rows if r['issues']]
        report.append({'lang': lang, 'pages': len(rows), 'failures': failures,
                       'routes': [r['route'] for r in rows]})
        print(lang + ': ' + str(len(rows)) + ' pages, ' + str(len(failures)) + ' failed', flush=True)
    result = json.dumps(report, ensure_ascii=False).encode()
    wire = base64.b64encode(gzip.compress(result)).decode()
    if len(wire) > 7000:
        for row in report:
            row.pop('routes', None)
        wire = base64.b64encode(gzip.compress(json.dumps(report, ensure_ascii=False).encode())).decode()
    print('AUDIT_RESULT=' + wire)
    print('PBOOT_BUILD_DONE')

if __name__ == '__main__':
    run()
