<?php
// Exercise the real PB query builder/model against an isolated in-memory SQLite fixture.
$root = $argv[1] ?? 'E:/phpstudy_pro/WWW/shanbo-rig.c';
require $root . '/core/basic/Model.php';
require $root . '/apps/home/model/ParserModel.php';
function get_lg() { return $GLOBALS['language']; }
function escape_string($s) { return str_replace("'", "''", $s); }
function decode_string($v) { return $v; }
function decode_slashes($v) { return $v; }
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE ay_content_sort (id INTEGER, acode TEXT, scode TEXT, pcode TEXT, name TEXT, filename TEXT, outlink TEXT, mcode TEXT, gid INTEGER);
CREATE TABLE ay_content (id INTEGER, acode TEXT, scode TEXT, subscode TEXT, filename TEXT, title TEXT, status INTEGER, date TEXT, gid INTEGER);
CREATE TABLE ay_model (mcode TEXT, type INTEGER, urlname TEXT, name TEXT);
CREATE TABLE ay_member_group (id INTEGER, gcode TEXT);
CREATE TABLE ay_content_ext (contentid INTEGER);
INSERT INTO ay_model VALUES ("5",2,"product","Product");');
$langs = ['cn','en','es','fr','ar','pt','ru','id','vi','tr'];
foreach ($langs as $i => $lang) {
    $id = $i + 1;
    $q = $db->prepare('INSERT INTO ay_content_sort VALUES (?, ?, ?, "0", ?, "Split-Type-Core-Drilling-Rig", "", "5", 0)');
    $q->execute([$id,$lang,(string)$id,$lang . ' category']);
    $q = $db->prepare('INSERT INTO ay_content VALUES (?, ?, ?, "", "cr1000p", ?, 1, "2020-01-01", 0)');
    $q->execute([$id,$lang,(string)$id,$lang . ' product']);
    $db->exec('INSERT INTO ay_content_ext VALUES (' . $id . ')');
}
$adapter = new class($db) {
    private $db;
    function __construct($db) { $this->db = $db; }
    function one($sql, $type) { return $this->db->query($sql)->fetch(PDO::FETCH_OBJ); }
};
$reflection = new ReflectionClass('app\home\model\ParserModel');
$model = $reflection->newInstanceWithoutConstructor();
$driver = new ReflectionProperty('core\basic\Model', 'dbDriver');
$driver->setAccessible(true); $driver->setValue($model, $adapter);
$checks = 0;
function check($condition, $description) {
    if (!$condition) throw new RuntimeException($description);
    $GLOBALS['checks']++;
}
foreach ($langs as $i => $lang) {
    $GLOBALS['language'] = $lang;
    check($model->getSort('Split-Type-Core-Drilling-Rig')->acode === $lang, "$lang duplicate category slug");
    check($model->getContent('cr1000p')->acode === $lang, "$lang duplicate product slug");
    check($model->getAbout('Split-Type-Core-Drilling-Rig')->acode === $lang, "$lang duplicate about slug");
    check($model->getSort('1')->acode === 'cn', 'Explicit cross-language category ID');
    check($model->getContent('1')->acode === 'cn', 'Explicit cross-language product ID');
}
$db->exec('UPDATE ay_content_sort SET filename="ru-unique" WHERE acode="ru";
UPDATE ay_content SET filename="ru-unique-product" WHERE acode="ru";');
$GLOBALS['language'] = 'en';
check($model->getSort('ru-unique')->acode === 'ru', 'Local language-prefixed category stays accessible');
check($model->getContent('ru-unique-product')->acode === 'ru', 'Local language-prefixed product stays accessible');
check(!$model->getSort('missing'), 'Missing category');
check(!$model->getContent('missing'), 'Missing product');
$db->exec('UPDATE ay_content SET status=0 WHERE acode="ru"');
check(!$model->getContent('ru-unique-product'), 'Unpublished content stays hidden');
$db->exec('UPDATE ay_content SET status=1,date="2999-01-01" WHERE acode="ru"');
check(!$model->getContent('ru-unique-product'), 'Future content stays hidden');
echo "$checks language routing checks passed.\n";
