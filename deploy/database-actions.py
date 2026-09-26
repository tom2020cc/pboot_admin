#!/usr/bin/env python3
"""Database maintenance invoked by the authenticated local publishing tool.

No schema changes. Online accounts, runtime configuration and site bindings remain
online-owned. File renames run only while all relevant writers are stopped.
"""
import base64
from contextlib import contextmanager
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
MANAGER_KEEP = {'user', 'managed_sites', 'seo_content_plan', 'seo_content_control', 'seo_content_job', 'site_information_draft'}
# Form definitions are merged separately; they must never use wholesale row replacement.
PB_KEEP = {'ay_config', 'ay_user', 'ay_role', 'ay_user_role', 'ay_member', 'ay_member_group', 'ay_member_level', 'ay_message', 'ay_form', 'ay_form_field'}


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def regular(file, root):
    file = Path(os.path.abspath(file))
    if file.resolve() != file or root.resolve() not in file.parents or not file.is_file():
        raise ValueError('数据库路径必须是对应目录内的普通文件，不能是链接')
    return file


def connect(file):
    return sqlite3.connect('file:' + Path(file).as_posix() + '?mode=rw', uri=True, timeout=20)


@contextmanager
def opened(file):
    db = connect(file)
    try:
        with db:
            yield db
    finally:
        db.close()


def env_database(root):
    text = regular(root / 'backend/.env', root).read_text()
    if not re.search(r'^APP_ENVIRONMENT\s*=\s*[\"\x27]?baota[\"\x27]?\s*$', text, re.M):
        raise ValueError('仅允许操作 APP_ENVIRONMENT=baota 的线上项目')
    match = re.search(r'^DB_SQLJS_LOCATION\s*=\s*(.+)$', text, re.M)
    name = match.group(1).strip().strip('\"\x27') if match else 'dev.sqlite'
    return regular(root / 'backend' / name, root), text


def php_database(root):
    config = regular(root / 'config/database.php', root)
    text = config.read_text()
    active = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
    types = re.findall(r'[\"\x27]type[\"\x27]\s*=>\s*[\"\x27]([^\"\x27]+)', active)
    names = re.findall(r'[\"\x27]dbname[\"\x27]\s*=>\s*[\"\x27]([^\"\x27]+)', active)
    if types != ['sqlite'] or len(names) != 1:
        raise ValueError('仅支持配置明确的 PbootCMS SQLite 数据库')
    return regular(root / names[0].lstrip('/'), root / 'data'), config, text, names[0]


def info(root, request):
    manager, env_text = env_database(root)
    if request['scope'] == 'manager':
        target = manager
        site = None
    elif request['scope'] == 'site':
        with opened(manager) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute('SELECT * FROM managed_sites WHERE code=?', (request.get('siteCode'),)).fetchall()
        if len(rows) != 1 or rows[0]['environment'] != 'baota':
            raise ValueError('线上站点不存在或不属于宝塔环境')
        site = dict(rows[0])
        target, _, _, _ = php_database(Path(site['rootPath']))
        if Path(site['dbPath']).resolve() != target:
            raise ValueError('线上站点档案与 PB 的数据库路径不一致，请先核对站点配置')
    else:
        raise ValueError('未知数据库类型')
    with opened(target) as db:
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    revision = hashlib.sha256((str(target) + env_text + (json.dumps(site, sort_keys=True) if site else '')).encode()).hexdigest()
    result = {'path': str(target), 'name': target.name, 'tables': len(tables), 'revision': revision, 'site': site}
    if site:
        php = set()
        for file in glob.glob('/www/server/panel/vhost/nginx/*.conf'):
            text = Path(file).read_text(errors='replace')
            if re.search(r'\broot\s+[\"\x27]?' + re.escape(site['rootPath']) + r'/?[\"\x27]?\s*;', text):
                php.update(re.findall(r'enable-php-(\d+)\.conf', text))
        if len(php) == 1:
            version = next(iter(php))
            result['phpService'] = '/etc/init.d/php-fpm-' + version
            result['affectedPhpSites'] = sum('enable-php-' + version + '.conf' in Path(f).read_text(errors='replace') for f in glob.glob('/www/server/panel/vhost/nginx/*.conf'))
    return result


def columns(db, table):
    return [r[1] for r in db.execute('PRAGMA table_info(' + ident(table) + ')')]


def rows_digest(rows):
    # Compare values, including blanks and BLOBs, independently of insertion order.
    encoded = sorted(json.dumps(list(row), ensure_ascii=True, default=lambda value: {'blob': value.hex()}) for row in rows)
    return hashlib.sha256('\n'.join(encoded).encode()).hexdigest()


def area_rows(db):
    return [dict(zip(['acode', 'name', 'domain', 'is_default'], row)) for row in db.execute(
        "SELECT acode,name,coalesce(domain,''),CAST(is_default AS INTEGER) FROM ay_area WHERE coalesce(pcode,'0')='0' ORDER BY acode")]


def area_revision(areas):
    return hashlib.sha256(json.dumps(areas, ensure_ascii=True, sort_keys=True).encode()).hexdigest()


def validate_areas(areas):
    if not isinstance(areas, list) or not 1 <= len(areas) <= 500:
        raise ValueError('区域配置为空或超过 500 个')
    codes, domains = set(), set()
    for row in areas:
        if not isinstance(row, dict) or not re.fullmatch(r'[a-z]{2}', str(row.get('acode', ''))):
            raise ValueError('区域编码必须为两位小写字母')
        if row['acode'] in codes:
            raise ValueError('区域编码重复')
        codes.add(row['acode'])
        if not isinstance(row.get('name'), str) or not row['name'].strip() or len(row['name']) > 100:
            raise ValueError('区域名称为空或过长')
        if row.get('is_default') not in (0, 1) or not isinstance(row.get('domain'), str):
            raise ValueError('默认语言或域名格式错误')
        for domain in row['domain'].split(',') if row['domain'] else []:
            # PB uses comma-separated hostnames, not URLs or local development hosts.
            if domain != domain.strip() or len(domain) > 253 or not re.fullmatch(
                    r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}', domain):
                raise ValueError('请使用逗号分隔的正式域名：' + row['acode'])
            if domain.lower().endswith(('.localhost', '.local', '.test', '.invalid', '.example')):
                raise ValueError('不能同步本地测试域名')
            if domain.lower() in domains:
                raise ValueError('多个区域绑定了同一个域名：' + domain)
            domains.add(domain.lower())
    if sum(row['is_default'] for row in areas) != 1:
        raise ValueError('必须且只能有一个默认语言')


def sync_areas(destination, areas, revision):
    """Merge by language code; never replace IDs or delete online-only languages."""
    validate_areas(areas)
    with opened(destination) as db:
        db.execute('BEGIN IMMEDIATE')
        previous = area_rows(db)
        if area_revision(previous) != revision:
            raise ValueError('线上区域配置已变化，请重新预览')
        existing = {row['acode']: row for row in previous}
        incoming = {row['acode']: row for row in areas}
        for row in previous:
            if row['acode'] not in incoming:
                # Preserve extra languages, but the requested default must be unique.
                incoming[row['acode']] = {**row, 'is_default': 0}
        validate_areas(list(incoming.values()))
        stamp = time.strftime('%Y-%m-%d %H:%M:%S')
        db.execute("UPDATE ay_area SET is_default=0 WHERE coalesce(pcode,'0')='0'")
        added = 0
        for row in areas:
            values = (row['name'], row['domain'], row['is_default'], stamp, row['acode'])
            if row['acode'] in existing:
                db.execute("UPDATE ay_area SET name=?,domain=?,is_default=?,update_time=?,update_user='admin' WHERE acode=? AND coalesce(pcode,'0')='0'", values)
            else:
                if db.execute('SELECT 1 FROM ay_area WHERE acode=?', (row['acode'],)).fetchone():
                    raise ValueError('区域编码与线上下级区域冲突：' + row['acode'])
                db.execute("INSERT INTO ay_area (name,domain,is_default,update_time,acode,pcode,create_time,create_user,update_user) VALUES (?,?,?,?,?,'0',?,'admin','admin')", (*values, stamp))
                added += 1
            # A language's first bound host is also its public site domain.
            profiles = db.execute('SELECT id,domain FROM ay_site WHERE acode=?', (row['acode'],)).fetchall()
            if len(profiles) > 1:
                raise ValueError('线上站点资料重复：' + row['acode'])
            if profiles:
                primary = row['domain'].split(',')[0]
                scheme = re.match(r'^https?://', profiles[0][1] or '', re.I)
                linked = ((scheme.group(0).lower() if scheme else '') + primary) if primary else ''
                db.execute('UPDATE ay_site SET domain=? WHERE id=?', (linked, profiles[0][0]))
                if db.execute('SELECT domain FROM ay_site WHERE id=?', (profiles[0][0],)).fetchone()[0] != linked:
                    raise ValueError('站点主域名联动核验失败')
        expected = sorted(incoming.values(), key=lambda row: row['acode'])
        if area_rows(db) != expected:
            raise ValueError('区域配置内容核验失败，已取消写入')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('区域配置数据库校验失败，已取消写入')
    return {'synced': len(areas), 'added': added, 'preserved': len(incoming) - len(areas), 'verified': True}


def write_config(file, text):
    st = file.stat()
    temp = file.with_name('.pboot-write-' + uuid.uuid4().hex)
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
        if hasattr(os, 'chown'):
            os.chown(temp, st.st_uid, st.st_gid)
        os.chmod(temp, st.st_mode & 0o777)
        os.replace(temp, file)
    finally:
        if temp.exists():
            temp.unlink()


def clear_pb_cache(root):
    for name in ['cache', 'config']:
        directory = root / 'runtime' / name
        if not directory.is_dir() or directory.is_symlink():
            continue
        for current, dirs, files in os.walk(directory):
            dirs[:] = [d for d in dirs if not (Path(current) / d).is_symlink()]
            for file in files:
                target = Path(current) / file
                if target.is_file() and not target.is_symlink():
                    target.unlink()


def sync_form_config(src, dst):
    """Sync definitions of existing forms, without copying visitor submissions."""
    if not columns(src, 'ay_form_field') and not columns(dst, 'ay_form_field'):
        return {}, {}
    for table in ['ay_form', 'ay_form_field']:
        required = {'id', 'fcode', 'table_name'} if table == 'ay_form' else {'id', 'fcode', 'name'}
        if not required.issubset(columns(src, table)) or columns(src, table) != columns(dst, table):
            raise ValueError('表单配置结构不兼容：' + table)
    forms = list(src.execute('SELECT * FROM ay_form'))
    if len({str(row['fcode']) for row in forms}) != len(forms):
        raise ValueError('本地表单编码重复')
    snapshots, counts = {}, {'ay_form': 0, 'ay_form_field': 0}
    for form in forms:
        code, table = form['fcode'], form['table_name']
        if not re.fullmatch(r'ay_message|ay_diy_[A-Za-z0-9_]+', str(table)):
            raise ValueError('不支持的表单数据表：' + str(table))
        existing = dst.execute('SELECT id,table_name FROM ay_form WHERE fcode=?', (code,)).fetchall()
        if len(existing) != 1 or existing[0][1] != table or not columns(dst, table):
            raise ValueError('表单编码或数据表不匹配，请先在线上建立对应表单：' + str(code))
        old_cols = columns(dst, table)
        if table not in snapshots:
            snapshots[table] = (old_cols, rows_digest(dst.execute('SELECT ' + ','.join(map(ident, old_cols)) + ' FROM ' + ident(table))))
        source_schema = {r[1]: r for r in src.execute('PRAGMA table_info(' + ident(table) + ')')}
        fields = list(src.execute('SELECT * FROM ay_form_field WHERE fcode=?', (code,)))
        if len({str(r['name']).lower() for r in fields}) != len(fields):
            raise ValueError('表单字段重复：' + str(code))
        for field in fields:
            name = field['name']
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', str(name)) or name not in source_schema:
                raise ValueError('本地表单字段缺少对应数据列：' + str(name))
            if name not in columns(dst, table):
                col = source_schema[name]
                # PB form fields are nullable text. Never rebuild tables or remove old columns.
                if not re.fullmatch(r'TEXT(?:\(\d+\))?', col[2], re.I) or col[3] or col[4] is not None or col[5]:
                    raise ValueError('表单新增字段不是兼容的可空文本列：' + name)
                dst.execute('ALTER TABLE ' + ident(table) + ' ADD COLUMN ' + ident(name) + ' ' + col[2])
        form_cols = [c for c in columns(src, 'ay_form') if c not in ('id', 'fcode')]
        dst.execute('UPDATE ay_form SET ' + ','.join(ident(c) + '=?' for c in form_cols) + ' WHERE id=?',
                    (*[form[c] for c in form_cols], existing[0][0]))
        field_cols = [c for c in columns(src, 'ay_form_field') if c != 'id']
        dst.execute('DELETE FROM ay_form_field WHERE fcode=?', (code,))
        expected = [tuple(row[c] for c in field_cols) for row in fields]
        dst.executemany('INSERT INTO ay_form_field (' + ','.join(map(ident, field_cols)) + ') VALUES (' + ','.join('?' for _ in field_cols) + ')', expected)
        actual = dst.execute('SELECT ' + ','.join(map(ident, field_cols)) + ' FROM ay_form_field WHERE fcode=?', (code,))
        if rows_digest(actual) != rows_digest(expected):
            raise ValueError('表单字段内容核验失败')
        actual_form = dst.execute('SELECT ' + ','.join(map(ident, form_cols)) + ' FROM ay_form WHERE id=?', (existing[0][0],)).fetchone()
        if tuple(actual_form) != tuple(form[c] for c in form_cols):
            raise ValueError('表单定义内容核验失败')
        counts['ay_form'] += 1
        counts['ay_form_field'] += len(fields)
    return counts, snapshots


def sync_rows(source, destination, scope):
    src, dst = connect(source), connect(destination)
    src.row_factory = sqlite3.Row
    try:
        if src.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('上传的数据库完整性检查未通过')
        keep = set(MANAGER_KEEP if scope == 'manager' else PB_KEEP)
        if scope == 'site':
            for db in [src, dst]:
                if 'table_name' in columns(db, 'ay_form'):
                    keep.update(r[0] for r in db.execute('SELECT table_name FROM ay_form') if str(r[0]).startswith('ay_'))
        tables = [r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") if r[0] not in keep]
        if not tables:
            raise ValueError('源库没有可同步的数据表')
        site_map = {}
        if scope == 'manager':
            local = dict(src.execute('SELECT code,id FROM managed_sites'))
            online = dict(dst.execute('SELECT code,id FROM managed_sites'))
            if set(local) != set(online):
                raise ValueError('两端站点编码列表不一致；请先在两端建立对应站点，避免覆盖其他站点数据')
            site_map = {local[k]: online[k] for k in local}
        for table in tables:
            if columns(src, table) != columns(dst, table):
                local_columns, online_columns = columns(src, table), columns(dst, table)
                missing = [name for name in local_columns if name not in online_columns]
                extra = [name for name in online_columns if name not in local_columns]
                def describe(names):
                    labels = {}
                    if scope == 'site' and table == 'ay_content_ext' and {'name', 'description'}.issubset(columns(src, 'ay_extfield')):
                        labels = dict(src.execute('SELECT name,description FROM ay_extfield'))
                    return '、'.join((str(labels[name]) + '（' + name + '）') if labels.get(name) else name for name in names)
                details = []
                if missing:
                    details.append('线上缺少字段：' + describe(missing))
                if extra:
                    details.append('本地缺少字段：' + describe(extra))
                if not details:
                    details.append('字段顺序不一致')
                message = '数据表结构不一致：' + table + '；' + '；'.join(details) + '。本次数据库未写入；请先核对并同步字段结构。'
                if scope == 'site':
                    message += '单独上传代码不会补齐 PB 产品字段。'
                raise ValueError(message)
        dst.execute('BEGIN EXCLUSIVE')
        preserved = {}
        if scope == 'site':
            for table, fields in [('ay_area', ['domain', 'is_default']), ('ay_site', ['domain', 'theme', 'statistical'])]:
                preserved[table] = (fields, list(dst.execute('SELECT acode,' + ','.join(map(ident, fields)) + ' FROM ' + ident(table))))
            source_codes = {r[0] for r in src.execute('SELECT acode FROM ay_area')}
            if any(row[0] not in source_codes for row in preserved['ay_area'][1]):
                raise ValueError('本地缺少线上已有的语言区域，未覆盖线上数据库')
        counts = {}
        expected_content = {}
        form_counts, visitor_snapshots = sync_form_config(src, dst) if scope == 'site' else ({}, {})
        for table in tables:
            cols = columns(src, table)
            rows = []
            for row in src.execute('SELECT * FROM ' + ident(table)):
                values = list(row)
                if 'siteId' in cols:
                    idx = cols.index('siteId')
                    if values[idx] not in site_map:
                        raise ValueError('数据引用了未匹配的站点：' + table)
                    values[idx] = site_map[values[idx]]
                rows.append(values)
            dst.execute('DELETE FROM ' + ident(table))
            if rows:
                dst.executemany('INSERT INTO ' + ident(table) + '(' + ','.join(map(ident, cols)) + ') VALUES (' + ','.join('?' for _ in cols) + ')', rows)
            counts[table] = len(rows)
            if scope == 'manager':
                expected_content[table] = rows_digest(rows)
        for table, (fields, rows) in preserved.items():
            dst.execute('UPDATE ' + ident(table) + ' SET ' + ','.join(ident(k) + '=0' if k == 'is_default' else ident(k) + "=''" for k in fields))
            for row in rows:
                dst.execute('UPDATE ' + ident(table) + ' SET ' + ','.join(ident(k) + '=?' for k in fields) + ' WHERE acode=?', (*row[1:], row[0]))
        for table, expected in counts.items():
            if dst.execute('SELECT COUNT(*) FROM ' + ident(table)).fetchone()[0] != expected:
                raise ValueError('同步后行数核验失败：' + table)
            if table in expected_content and rows_digest(dst.execute('SELECT * FROM ' + ident(table))) != expected_content[table]:
                raise ValueError('同步后内容核验失败，已取消写入：' + table)
        if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or dst.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('同步后数据库校验失败，已取消写入')
        for table, (cols, digest) in visitor_snapshots.items():
            if rows_digest(dst.execute('SELECT ' + ','.join(map(ident, cols)) + ' FROM ' + ident(table))) != digest:
                raise ValueError('线上客户留言发生变化，已取消写入：' + table)
        dst.commit()
        return {**counts, **form_counts}
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()


def rename_database(root, state, name):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}\.(?:db|sqlite|sqlite3)', name):
        raise ValueError('名称仅支持字母、数字、下划线、短横线及 .db/.sqlite/.sqlite3 后缀')
    old = Path(state['path'])
    new = old.with_name(name)
    if new == old:
        return str(old)
    if new.exists() or new.is_symlink():
        raise ValueError('目标文件名已存在，不会覆盖')
    with opened(old) as db:
        if db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
            raise ValueError('数据库仍有写入，请稍后重试')
        db.execute('PRAGMA journal_mode=DELETE')
    manager, env_text = env_database(root)
    site = state['site']
    config = root / 'backend/.env'
    original = env_text
    if site:
        _, config, original, configured = php_database(Path(site['rootPath']))
        relative = '/' + new.relative_to(site['rootPath']).as_posix()
        updated, number = re.subn(r'([\"\x27]dbname[\"\x27]\s*=>\s*[\"\x27])' + re.escape(configured) + r'([\"\x27])', lambda m: m[1] + relative + m[2], original)
        if number != 1:
            raise ValueError('数据库配置项不是唯一项，未改名')
    else:
        relative = os.path.relpath(new, root / 'backend').replace('\\', '/')
        updated, number = re.subn(r'^DB_SQLJS_LOCATION\s*=.*$', lambda _: 'DB_SQLJS_LOCATION=' + relative, original, flags=re.M)
        if not number:
            updated += '\nDB_SQLJS_LOCATION=' + relative + '\n'
    renamed = False
    try:
        old.rename(new)
        renamed = True
        write_config(config, updated)
        if site:
            with opened(manager) as db:
                db.execute('UPDATE managed_sites SET dbPath=? WHERE code=?', (str(new), site['code']))
        with opened(new) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('改名后数据库校验失败')
        return str(new)
    except Exception:
        write_config(config, original)
        if renamed:
            new.rename(old)
        if site:
            with opened(manager) as db:
                db.execute('UPDATE managed_sites SET dbPath=? WHERE code=?', (str(old), site['code']))
        raise


def runtime_environment():
    import pwd
    env = dict(os.environ)
    home = pwd.getpwuid(os.getuid()).pw_dir
    env['HOME'] = home
    env.setdefault('PM2_HOME', home + '/.pm2')
    dirs = sorted(glob.glob('/www/server/nvm/versions/node/*/bin') + glob.glob('/www/server/nodejs/*/bin'), reverse=True)
    env['PATH'] = ':'.join(dirs) + ':' + env.get('PATH', '')
    return env


def main(request):
    state = info(ROOT, request)
    if request['action'] in ['inspect-areas', 'sync-areas'] and request.get('scope') != 'site':
        raise ValueError('区域配置只能同步到 PB 网站')
    if request['action'] == 'inspect-areas':
        with opened(state['path']) as db:
            areas = area_rows(db)
        return {**{k: v for k, v in state.items() if k != 'site'}, 'areas': areas, 'areaRevision': area_revision(areas)}
    if request['action'] == 'inspect':
        return {k: v for k, v in state.items() if k != 'site'}
    if request['action'] not in ['rename', 'sync', 'sync-areas'] or request.get('revision') != state['revision']:
        raise ValueError('线上数据库配置已变化，请重新读取后操作')
    if request['action'] == 'sync-areas':
        validate_areas(request.get('areas'))
    source = None
    if request['action'] == 'sync':
        source = regular(ROOT / 'data/sync-staging' / request['source'], ROOT / 'data/sync-staging')
        if hashlib.sha256(source.read_bytes()).hexdigest() != request.get('sha256'):
            raise ValueError('上传文件校验失败')
    env = runtime_environment()
    def pm2(*args):
        return subprocess.check_output(['pm2', *args], env=env, text=True, stderr=subprocess.STDOUT)
    apps = json.loads(pm2('jlist'))
    api = next((a for a in apps if a['name'] == 'pboot-admin-api'), None)
    if not api or api['pm2_env'].get('DB_SQLJS_LOCATION'):
        raise ValueError('未找到后端进程，或 PM2 单独指定了数据库路径；请先统一使用 backend/.env')
    stopped = []
    php = state.get('phpService') if request['action'] == 'rename' and state['site'] else None
    if request['action'] == 'rename' and state['site'] and (not php or not request.get('allowPhpPause')):
        raise ValueError('网站数据库改名需要先确认暂停对应 PHP 服务')
    if php and not Path(php).is_file():
        raise ValueError('未找到对应 PHP 服务，未开始改名')
    php_stopped = False
    try:
        for app in ['pboot-seo-content-worker', 'pboot-admin-api']:
            if any(a['name'] == app and a['pm2_env']['status'] == 'online' for a in apps):
                stopped.append(app)
                pm2('stop', app)
        if php:
            php_stopped = True
            subprocess.run([php, 'stop'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if request['action'] == 'rename':
            result = {'path': rename_database(ROOT, state, request.get('name', ''))}
        elif request['action'] == 'sync-areas':
            result = {'path': state['path'], **sync_areas(state['path'], request['areas'], request.get('areaRevision'))}
        else:
            result = {'path': state['path'], 'counts': sync_rows(source, state['path'], request['scope'])}
            if request['scope'] == 'manager':
                result['contentVerified'] = True
        if state['site']:
            clear_pb_cache(Path(state['site']['rootPath']))
    finally:
        restart_errors = []
        if php_stopped:
            try:
                subprocess.run([php, 'start'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            except Exception as error:
                restart_errors.append(str(error))
        for app in reversed(stopped):
            try:
                pm2('restart', app)
            except Exception as error:
                restart_errors.append(str(error))
        if restart_errors:
            raise ValueError('服务恢复失败，请在宝塔检查：' + '; '.join(restart_errors))
    if 'pboot-admin-api' in stopped:
        for _ in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:5108/project-identity', timeout=3) as response:
                    if json.load(response).get('environment') == 'baota':
                        return result
            except Exception:
                pass
            time.sleep(2)
        raise ValueError('数据库操作已执行，但服务健康检查未通过，请检查宝塔日志')
    return result


if __name__ == '__main__':
    try:
        request = json.loads(base64.b64decode(sys.argv[1]))
        print('PBOOT_DATABASE_RESULT=' + json.dumps(main(request), ensure_ascii=False))
        print('PBOOT_BUILD_DONE')
    except Exception as error:
        print('PBOOT_BUILD_FAILED ' + str(error))
        sys.exit(1)
