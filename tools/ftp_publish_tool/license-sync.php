<?php
// Short-lived, fixed-purpose task. Values are encrypted; no arbitrary SQL or paths accepted.
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
    if ($plain === false) throw new Exception('Invalid task');
    $profile = json_decode($plain, true);
    $host = strtolower(explode(':', $_SERVER['HTTP_HOST'])[0]);
    if (!in_array($host, $profile['domains'], true)) throw new Exception('Domain mismatch');
    $root = realpath(__DIR__);
    $config = require $root . '/config/database.php';
    $config = $config['database'];
    if (strtolower($config['type']) !== 'sqlite') throw new Exception('Only SQLite supported');
    $database = realpath($root . '/' . ltrim($config['dbname'], '/'));
    $data = realpath($root . '/data');
    if (!$database || !$data || strpos($database, $data . DIRECTORY_SEPARATOR) !== 0 || !is_file($database)) throw new Exception('Invalid database');
    $db = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('BEGIN IMMEDIATE');
    $values = ['sn' => $profile['codes'], 'sn_user' => $profile['phone'], 'licensecode' => base64_encode($profile['codes'] . '/' . $profile['phone']) . substr($profile['codes'], 1, 1)];
    $get = $db->prepare('SELECT value FROM ay_config WHERE name=?');
    $set = $db->prepare('UPDATE ay_config SET value=? WHERE name=?');
    foreach ($values as $name => $value) {
        $get->execute([$name]);
        if (count($get->fetchAll(PDO::FETCH_COLUMN)) !== 1) throw new Exception('Missing or duplicate license field');
        $set->execute([$value, $name]);
        $get->execute([$name]);
        if ($get->fetchColumn() !== $value) throw new Exception('Verification failed');
    }
    $db->exec('COMMIT');
    // Verify committed values with a separate read connection.
    $db = null;
    $verify = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $get = $verify->prepare('SELECT value FROM ay_config WHERE name=?');
    foreach ($values as $name => $value) { $get->execute([$name]); if ($get->fetchColumn() !== $value) throw new Exception('Readback failed'); }
    $warnings = [];
    $cache = $root . '/runtime/config';
    if (is_dir($cache)) {
        if (is_link($cache) || strpos(realpath($cache), $root . DIRECTORY_SEPARATOR) !== 0) $warnings[] = '请在 PB 后台清理配置缓存';
        else foreach (glob($cache . '/*.php') as $file) if (is_file($file) && !is_link($file) && !unlink($file)) $warnings[] = '请在 PB 后台清理配置缓存';
    }
    $result = ['ok' => true, 'digest' => hash('sha256', $plain), 'warnings' => array_values(array_unique($warnings))];
} catch (Throwable $error) {
    if ($db) { try { $db->exec('ROLLBACK'); } catch (Throwable $ignored) {} }
    $result = ['ok' => false, 'error' => '线上授权更新未通过校验，请检查 PB 数据库配置及写入权限后重试'];
}
// The FTP client also removes this task, including when HTTP fails.
@unlink(__FILE__);
$body = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
echo json_encode(['body' => $body, 'signature' => hash_hmac('sha256', $body, $key)]);
flock($lock, LOCK_UN);
fclose($lock);
