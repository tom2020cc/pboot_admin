<?php
// Encrypted, expiring task for fixed site/company fields only.
header('Content-Type: application/json');
header('Cache-Control: no-store');
ini_set('display_errors', '0');
$task = json_decode(base64_decode('__TASK__'), true);
if (time() > $task['expires']) { http_response_code(410); exit; }
if ($_SERVER['REQUEST_METHOD'] === 'GET') { echo json_encode(['proof' => $task['proof']]); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }
$key = base64_decode(file_get_contents('php://input'), true);
if (!$key || !hash_equals($task['keyHash'], hash('sha256', $key))) { http_response_code(403); exit; }
$lock = fopen(__FILE__, 'r');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { http_response_code(409); exit; }
$db = null;
try {
    $plain = openssl_decrypt(base64_decode($task['cipher']), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, base64_decode($task['iv']), base64_decode($task['tag']));
    if ($plain === false) throw new Exception('任务校验失败');
    $payload = json_decode($plain, true);
    if (!in_array(strtolower(explode(':', $_SERVER['HTTP_HOST'])[0]), $payload['domains'], true)) throw new Exception('线上域名不匹配');
    if (!$payload['items'] || count($payload['items']) > 30) throw new Exception('语言范围无效');
    $root = realpath(__DIR__);
    $config = require $root . '/config/database.php';
    $config = $config['database'];
    if (strtolower($config['type']) !== 'sqlite') throw new Exception('当前功能仅支持 SQLite 网站');
    $database = realpath($root . '/' . ltrim($config['dbname'], '/'));
    $data = realpath($root . '/data');
    if (!$database || !$data || strpos($database, $data . DIRECTORY_SEPARATOR) !== 0 || !is_file($database)) throw new Exception('线上数据库路径无效');
    foreach ($payload['assets'] as $asset) {
        if (!preg_match('~^static/codex/site-information-online/[a-f0-9]{64}\.(jpg|jpeg|png|gif|webp|avif|bmp|ico|svg)$~D', $asset['path'])) throw new Exception('图片路径无效');
        $file = $root;
        foreach (explode('/', $asset['path']) as $part) { $file .= '/' . $part; if (is_link($file)) throw new Exception('图片目录含符号链接'); }
        if (!is_file($file) || hash_file('sha256', $file) !== $asset['hash']) throw new Exception('线上图片校验失败，资料尚未更新');
    }
    $fields = [
        'site' => ['title','subtitle','domain','theme','logo','keywords','description','icp','copyright'],
        'company' => ['name','address','postcode','contact','mobile','phone','fax','email','qq','weixin','blicense','other']
    ];
    $db = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('BEGIN IMMEDIATE');
    $seen = [];
    $expectedBindings = [];
    foreach ($payload['items'] as $item) {
        $lang = $item['language'];
        if (!is_string($lang) || !preg_match('/^[a-z0-9_-]{1,20}$/D', $lang) || isset($seen[$lang])) throw new Exception('语言范围重复或无效');
        $seen[$lang] = true;
        $area = $db->prepare('SELECT domain FROM ay_area WHERE acode=?'); $area->execute([$lang]);
        $areaDomains = $area->fetchAll(PDO::FETCH_COLUMN);
        if (count($areaDomains) !== 1) throw new Exception('线上缺少语言区域：' . $lang . '，请先配置');
        foreach ($fields as $section => $keys) {
            $values = $item['data'][$section];
            if (count($values) !== count($keys) || array_diff(array_keys($values), $keys)) throw new Exception('资料含未知字段');
            foreach ($keys as $field) if (!array_key_exists($field, $values) || !is_string($values[$field])) throw new Exception('资料字段不完整');
            if ($section === 'site') {
                $primaryHost = '';
                if ($values['domain'] !== '') {
                    $url = parse_url(preg_match('~^https?://~i', $values['domain']) ? $values['domain'] : 'https://' . $values['domain']);
                    if (!$url || !in_array(strtolower($url['scheme'] ?? ''), ['http', 'https'], true) ||
                        isset($url['user']) || isset($url['pass']) || isset($url['port']) || isset($url['query']) || isset($url['fragment']) ||
                        !in_array($url['path'] ?? '', ['', '/'], true) || !in_array(strtolower($url['host'] ?? ''), $payload['domains'], true)) {
                        throw new Exception($lang . ' 的站点域名不在当前网站的线上域名列表中');
                    }
                    $primaryHost = strtolower($url['host']);
                }
                $aliases = array_values(array_filter(array_map(function ($host) { return strtolower(rtrim(trim($host), '.')); }, explode(',', (string)$areaDomains[0]))));
                if (!in_array($primaryHost, $aliases, true)) array_shift($aliases);
                $hosts = $primaryHost === '' ? [] : array_values(array_unique(array_merge([$primaryHost], $aliases)));
                $others = $db->prepare('SELECT acode,domain FROM ay_area WHERE acode<>?'); $others->execute([$lang]);
                foreach ($others->fetchAll(PDO::FETCH_ASSOC) as $other) {
                    $otherHosts = array_map(function ($host) { return strtolower(rtrim(trim($host), '.')); }, explode(',', (string)$other['domain']));
                    if (array_intersect($hosts, $otherHosts)) throw new Exception('域名已绑定到 ' . $other['acode'] . ' 区域');
                }
                $binding = implode(',', $hosts);
                $setArea = $db->prepare('UPDATE ay_area SET domain=? WHERE acode=?'); $setArea->execute([$binding, $lang]);
                $expectedBindings[$lang] = $binding;
                if ($values['theme'] !== '') {
                    if (!preg_match('/^[\p{L}\p{N}_-]+$/uD', $values['theme'])) throw new Exception($lang . ' 的模板名称无效');
                    $template = $root . '/template/' . $values['theme'] . '/html/index.html';
                    $cursor = $root;
                    foreach (['template', $values['theme'], 'html', 'index.html'] as $part) {
                        $cursor .= '/' . $part;
                        if (is_link($cursor)) throw new Exception($lang . ' 的模板路径含符号链接');
                    }
                    if (!is_file($template)) throw new Exception($lang . ' 的线上模板不存在，请先上传 template/' . $values['theme']);
                }
            }
            $table = 'ay_' . $section;
            $find = $db->prepare('SELECT id FROM ' . $table . ' WHERE acode=?'); $find->execute([$lang]);
            $ids = $find->fetchAll(PDO::FETCH_COLUMN);
            if (count($ids) > 1) throw new Exception('线上 ' . $lang . ' 的' . ($section === 'site' ? '站点' : '公司') . '资料重复，请先在 PB 检查');
            // Empty strings are intentional values, including an entirely empty company record.
            $params = array_map(function ($key) use ($values) { return $values[$key]; }, $keys);
            if (count($ids) === 1) {
                $set = $db->prepare('UPDATE ' . $table . ' SET ' . implode(',', array_map(function ($key) { return $key . '=?'; }, $keys)) . ' WHERE acode=?');
                $params[] = $lang;
            } else {
                $insertKeys = array_merge(['acode'], $keys);
                array_unshift($params, $lang);
                // Statistics stay online-specific; domain/template come from the selected language.
                if ($section === 'site') {
                    $insertKeys[] = 'statistical';
                    $params[] = '';
                }
                $set = $db->prepare('INSERT INTO ' . $table . ' (' . implode(',', $insertKeys) . ') VALUES (' . implode(',', array_fill(0, count($insertKeys), '?')) . ')');
            }
            $set->execute($params);
        }
    }
    $db->exec('COMMIT');
    $db = null;
    $verify = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    foreach ($expectedBindings as $lang => $binding) {
        $getArea = $verify->prepare('SELECT domain FROM ay_area WHERE acode=?'); $getArea->execute([$lang]);
        if ((string)$getArea->fetchColumn() !== $binding) throw new Exception('线上域名联动回读不一致，请重新同步');
    }
    foreach ($payload['items'] as $item) foreach ($fields as $section => $keys) {
        $get = $verify->prepare('SELECT ' . implode(',', $keys) . ' FROM ay_' . $section . ' WHERE acode=?');
        $get->execute([$item['language']]); $row = $get->fetch(PDO::FETCH_ASSOC);
        foreach ($keys as $field) if ((string)$row[$field] !== $item['data'][$section][$field]) throw new Exception('线上回读不一致，请重新同步');
    }
    $warnings = [];
    $clear = function ($dir) use (&$clear) {
        foreach (scandir($dir) as $name) {
            if ($name === '.' || $name === '..') continue;
            $file = $dir . '/' . $name;
            if (is_link($file)) continue;
            if (is_dir($file)) $clear($file);
            elseif (is_file($file) && !unlink($file)) throw new Exception('Cache');
        }
    };
    foreach (['runtime/config', 'runtime/cache', 'runtime/complile'] as $relative) {
        $dir = $root . '/' . $relative;
        if (!is_dir($dir)) continue;
        try {
            if (is_link($root . '/runtime') || is_link($dir) || strpos(realpath($dir), $root . DIRECTORY_SEPARATOR) !== 0) throw new Exception('Cache');
            $clear($dir);
        } catch (Throwable $ignored) { $warnings[] = '资料已更新，请在 PB 后台清理缓存'; }
    }
    $result = ['ok' => true, 'digest' => hash('sha256', $plain), 'warnings' => array_values(array_unique($warnings))];
} catch (Throwable $error) {
    if ($db) { try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) {} }
    $message = $error instanceof PDOException ? '请检查线上站点和公司字段及数据库写入权限' : $error->getMessage();
    $result = ['ok' => false, 'error' => $message];
}
@unlink(__FILE__);
$body = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
echo json_encode(['body' => $body, 'signature' => hash_hmac('sha256', $body, $key)]);
flock($lock, LOCK_UN); fclose($lock);
