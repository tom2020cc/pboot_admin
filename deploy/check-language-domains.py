"""Read-only domain launch diagnostics, invoked by the local publishing tool."""
import base64
import concurrent.futures
import contextlib
import gzip
import http.client
import importlib.util
import ipaddress
import json
from pathlib import Path
import re
import socket
import sqlite3
import ssl
import subprocess
import sys
import time


def check(status, detail, advice=''):
    return dict(status=status, detail=detail, advice=advice)


def classify_php(code, output):
    if '有效授权码' in output or '授权码错误' in output:
        return check('fail', 'PB 未匹配到此域名的有效授权码', '获取该域名的官方授权码，在系统授权码中同步到线上')
    if code == 0 and re.search(r'<html\b', output, re.I) and '错误信息' not in output:
        return check('pass', 'PB 已通过授权检查并生成页面')
    return check('unknown', 'PB 页面未正常生成，无法确认授权', '检查 PB 模板及 PHP 错误日志；不要把此结果视为授权通过')


def certificate(host, address):
    try:
        with socket.create_connection((address, 443), timeout=8) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as conn:
                cert = conn.getpeercert()
        days = int((ssl.cert_time_to_seconds(cert['notAfter']) - time.time()) / 86400)
        return check('warn' if days < 15 else 'pass', f'证书匹配，剩余 {days} 天', '检查证书自动续期' if days < 15 else '')
    except ssl.SSLCertVerificationError:
        return check('fail', '证书域名、有效期或信任链校验失败', '解析生效后，在宝塔重新申请包含此域名的证书')
    except (OSError, ssl.SSLError):
        return check('unknown', '无法完成 HTTPS 握手', '检查服务器 443 端口及 HTTPS 配置')


def homepage(host):
    conn = http.client.HTTPSConnection(host, timeout=8, context=ssl.create_default_context())
    try:
        conn.request('GET', '/', headers={'User-Agent': 'PbootLaunchCheck/1.0', 'Cache-Control': 'no-cache'})
        response = conn.getresponse()
        body = response.read(512 * 1024).decode('utf-8', errors='replace')
        if response.status == 200 and re.search(r'<html\b', body, re.I) and '错误信息' not in body:
            return check('pass', 'HTTPS 首页返回 200，收到 HTML 页面')
        if response.status in (301, 302, 307, 308):
            return check('warn', f'首页返回跳转 HTTP {response.status}', '检查跳转目标，确认未跳到其他语言；本检测不自动跟随跳转')
        return check('fail', f'首页 HTTP {response.status}，未确认正常页面', '若是 404，结合 PB 授权、模板及伪静态配置排查')
    except (OSError, ssl.SSLError, http.client.HTTPException):
        return check('unknown', '无法通过正常 HTTPS 地址读取首页', '先处理解析和证书，再重新检测')
    finally:
        conn.close()


PHP_PROBE = """$_SERVER['HTTP_HOST']=$argv[1];$_SERVER['SERVER_NAME']=$argv[1];
$_SERVER['SERVER_PORT']=443;$_SERVER['HTTPS']='on';$_SERVER['REQUEST_URI']='/';
$_SERVER['REQUEST_METHOD']='GET';$_SERVER['SCRIPT_NAME']='/index.php';
$_SERVER['DOCUMENT_ROOT']=$argv[2];$_SERVER['SCRIPT_FILENAME']=$argv[2].'/index.php';
$_SERVER['REMOTE_ADDR']='127.0.0.1';$_SERVER['HTTP_USER_AGENT']='PbootLaunchCheck/1.0';
chdir($argv[2]);require 'index.php';"""


def inspect_domain(item, allowed, expected_ip, root, configs, areas, sites):
    host, language = item['domain'], item['language']
    row = dict(language=language, domain=host, checks={})
    results = row['checks']
    if host not in allowed or not re.fullmatch(r'[a-z0-9.-]+', host):
        for key in ['dns', 'binding', 'tls', 'license', 'template', 'home']:
            results[key] = check('unknown', '未配置可检测的线上域名', '在区域管理及系统授权码中核对该语言的线上域名')
        return row
    try:
        addresses = sorted({entry[4][0] for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
        # A wrong/private DNS target must never become a request to an internal service.
        good_dns = bool(addresses) and all(ipaddress.ip_address(a).is_global for a in addresses) and expected_ip in addresses
        results['dns'] = check('pass' if good_dns else 'fail', ', '.join(addresses), '' if good_dns else f'核对 A/AAAA 记录；当前直连部署应指向 {expected_ip}，使用 CDN 时需单独核对源站')
    except socket.gaierror:
        good_dns = False
        results['dns'] = check('fail', 'DNS 未解析成功', f'检查域名解析，添加 A 记录指向 {expected_ip} 后等待生效')
    matches = [(name, text) for name, text in configs if any(host in names.split() for names in re.findall(r'\bserver_name\s+([^;]+);', text))]
    area_ok = [a for a in areas if a['acode'] == language and a['domain'] == host]
    results['binding'] = check('pass', '宝塔站点配置和 PB 区域绑定一致') if matches and len(area_ok) == 1 else check('fail', '宝塔域名绑定或 PB 语言区域不匹配', '在宝塔当前网站添加域名，并核对 PB 区域管理中的语言域名')
    results['tls'] = certificate(host, expected_ip)
    records = [s for s in sites if s['acode'] == language]
    theme = records[0]['theme'] if len(records) == 1 else ''
    valid_theme = bool(theme and re.fullmatch(r'[\w-]+', theme) and (root / 'template' / theme / 'html/index.html').is_file())
    results['template'] = check('pass', f'模板 {theme} 存在') if valid_theme else check('fail', '模板选择为空、重复或首页文件缺失', '同步该语言的站点模板选择，并上传对应模板文件')
    versions = set(v for _, text in matches for v in re.findall(r'enable-php-(\d+)\.conf', text))
    if len(versions) == 1:
        binary = '/www/server/php/' + next(iter(versions)) + '/bin/php'
        try:
            proc = subprocess.run(['runuser', '-u', 'www', '--', binary, '-r', PHP_PROBE, host, str(root)], capture_output=True, text=True, timeout=15)
            results['license'] = classify_php(proc.returncode, proc.stdout)
        except (OSError, subprocess.TimeoutExpired):
            results['license'] = check('unknown', 'PB 授权检测未完成', '检查网站 PHP 运行环境后重试')
    else:
        results['license'] = check('unknown', '未识别唯一 PHP 版本', '检查当前网站的宝塔 PHP 配置')
    results['home'] = homepage(host) if good_dns and results['tls']['status'] in ('pass', 'warn') else check('unknown', '解析或证书未通过，首页检查未执行', '先修复前面的失败项，再重新检测')
    return row


def run(request):
    project = Path(request['projectRoot'])
    # Reuse the deployment's path and environment checks, with all connections read-only.
    spec = importlib.util.spec_from_file_location('db_actions', project / 'deploy/database-actions.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.connect = lambda file: sqlite3.connect(Path(file).as_uri() + '?mode=ro', uri=True, timeout=5)
    info = module.info(project, {'scope': 'site', 'siteCode': request['siteCode']})
    root = Path(info['site']['rootPath'])
    with contextlib.closing(module.connect(info['path'])) as db:
        db.row_factory = sqlite3.Row
        areas = [dict(r) for r in db.execute('SELECT acode,domain FROM ay_area')]
        sites = [dict(r) for r in db.execute('SELECT acode,theme FROM ay_site')]
    configs = []
    for file in Path('/www/server/panel/vhost/nginx').glob('*.conf'):
        text = re.sub(r'#.*', '', file.read_text(errors='replace'))
        if re.search(r'\broot\s+[\"\x27]?' + re.escape(str(root)) + r'/?[\"\x27]?\s*;', text):
            configs.append((file.name, text))
    expected = request['expectedIp']
    if not ipaddress.ip_address(expected).is_global:
        raise ValueError('线上服务器必须是公网 IP')
    items = request['items']
    if not 1 <= len(items) <= 30:
        raise ValueError('语言数量应为 1 到 30 个')
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(lambda item: inspect_domain(item, request['domains'], expected, root, configs, areas, sites), items))
    return dict(rows=rows, checkedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), siteCode=request['siteCode'])


if __name__ == '__main__':
    try:
        result = run(json.loads(base64.b64decode(sys.argv[1])))
        # BaoTa returns only the final 8 KiB of task logs. Keep the complete report in one small frame.
        encoded = base64.b64encode(gzip.compress(json.dumps(result, ensure_ascii=False).encode())).decode()
        if len(encoded) > 7000:
            raise ValueError('检测报告超过传输限制，请减少单站语言数量')
        print('PBOOT_DOMAIN_RESULT_Z=' + encoded)
        print('PBOOT_BUILD_DONE')
    except Exception as error:
        print('PBOOT_DOMAIN_ERROR=' + str(error))
        print('PBOOT_BUILD_FAILED')
        sys.exit(1)
