<?php
// Test the actual PB controller with isolated configuration; no DB or HTTP writes.
namespace core\basic {
    class Config {
        public static $values = [];
        public static function get($name, $array = false) {
            return self::$values[$name] ?? ($array ? [] : null);
        }
    }
    class Controller {
        public $theme;
        public function config($name) { return Config::get($name); }
        public function setTheme($theme) { $this->theme = $theme; }
    }
}
namespace app\common {
    function cache_config() {}
    function is_https() { return true; }
    function get_user_ip() { return ''; }
    function get_http_host() { return $GLOBALS['test_host']; }
    function cookie($name, $value) { $_COOKIE[$name] = $value; }
    function get_default_lg() { return 'en'; }
    function get_theme() { return 'theme-' . $_COOKIE['lg']; }
}
namespace {
    $root = $argv[1] ?? 'E:/phpstudy_pro/WWW/shanbo-rig.c';
    require $root . '/apps/common/HomeController.php';
    $languages = [];
    foreach (['cn','en','es','fr','ar','pt','ru','id','vi','tr'] as $code) {
        $languages[] = ['acode' => $code, 'domain' => $code === 'en' ? 'shanbo-rig.com,www.shanbo-rig.com' : $code . '.shanbo-rig.com'];
    }
    $checks = 0;
    function check($actual, $expected, $label) {
        if ($actual !== $expected) throw new \RuntimeException($label . ': ' . var_export($actual, true));
        $GLOBALS['checks']++;
    }
    foreach ($languages as $language) {
        foreach (explode(',', $language['domain']) as $host) {
            check(\app\common\HomeController::resolveDomainLanguage($languages, $host), $language['acode'], $host);
            check(\app\common\HomeController::resolveDomainLanguage($languages, strtoupper($host) . '.'), $language['acode'], 'normalized ' . $host);
        }
    }
    foreach (['shanbo-rig.c','localhost','evilshanbo-rig.com','www.shanbo-rig.com.evil.test',''] as $host) {
        check(\app\common\HomeController::resolveDomainLanguage($languages, $host), null, 'unbound ' . $host);
    }
    check(\app\common\HomeController::resolveDomainLanguage([['acode'=>'en','domain'=>' shanbo-rig.com, www.shanbo-rig.com ']], 'www.shanbo-rig.com'), 'en', 'single language, whitespace');
    check(\app\common\HomeController::resolveDomainLanguage([['acode'=>'en','domain'=>'']], 'localhost'), null, 'empty binding');
    \core\basic\Config::$values['lgs'] = $languages;
    $GLOBALS['test_host'] = 'www.shanbo-rig.com';
    $_COOKIE['lg'] = 'cn';
    $controller = new \app\common\HomeController();
    check($_COOKIE['lg'], 'en', 'bound domain overrides previous CN cookie');
    check($controller->theme, 'theme-en', 'English theme selected after cookie correction');
    echo "$checks domain language checks passed.\n";
}
