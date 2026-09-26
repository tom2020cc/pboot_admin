<?php
// php tools/test-product-list-specs.php [PB website root]
$root = isset($argv[1]) ? $argv[1] : dirname(__DIR__) . '/../shanbo-rig.c';
require $root . '/apps/home/controller/ProductSpecsRenderer.php';
use app\home\controller\ProductSpecsRenderer;

function check($condition, $message) {
    if (!$condition) { fwrite(STDERR, $message . "\n"); exit(1); }
}
function field($name, $sort, $label = '', $type = 1, $model = 3) {
    return array('name' => $name, 'sorting' => $sort, 'description' => $label ?: $name, 'type' => $type, 'mcode' => $model);
}
$fields = array(field('ext_new_d', 40), field('ext_new_b', 20), field('ext_new_c', 30), field('ext_new_a', 10));
check(ProductSpecsRenderer::render((object) array(), $fields, 'en') === '', 'No properties must produce no container');
check(ProductSpecsRenderer::render(array('ext_new_a' => " \n ", 'ext_new_b' => null), $fields, 'en') === '', 'Whitespace/null must be omitted');
foreach (array(1, 2, 3, 4) as $count) {
    $values = array_slice(array('ext_new_a' => '0', 'ext_new_b' => '2', 'ext_new_c' => '3', 'ext_new_d' => '4'), 0, $count);
    $html = ProductSpecsRenderer::render($values, $fields, 'en');
    check(substr_count($html, 'data-spec=') === min(3, $count), 'Must return actual count, capped at three');
    check(strpos($html, '<dd>0</dd>') !== false, 'Zero is a real value');
    check(strpos($html, 'ext_new_d') === false, 'Sort before limiting');
    check(strpos($html, 'Not provided') === false, 'No placeholder');
}
$html = ProductSpecsRenderer::render(array('EXT_BRAND_NEW' => '24'), array(field('ext_brand_new', 0, 'New attribute')), 'en');
check(strpos($html, 'New attribute</dt><dd>24') !== false, 'Unknown fields need no template or dictionary entry');
$excluded = array(field('ext_video', 0), field('ext_cp_BigPic', 0, '', 5), field('ext_pullback', 0), field('ext_shared_specs', 0), field('ext_other_model', 0, '', 1, 4));
$values = array(); foreach ($excluded as $f) { $values[$f['name']] = 'should not display'; }
check(ProductSpecsRenderer::render($values, $excluded, 'cn') === '', 'Exclude media, retired fields, and other models');
$html = ProductSpecsRenderer::render(array('ext_new_a' => '<script>[list:title]{pboot:site}</script>'), array(field('ext_new_a', 0, '<b>label</b>')), 'en');
check(strpos($html, '<script>') === false && strpos($html, '<b>') === false && strpos($html, '[list:') === false && strpos($html, '{pboot:') === false, 'Escape HTML and template syntax');
foreach (array('cn', 'en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'vi', 'tr') as $language) {
    $html = ProductSpecsRenderer::render(array('ext_param_3bf54e96cb68cc44' => '13000'), array(field('ext_param_3bf54e96cb68cc44', 0, '最大扭矩')), $language);
    check(strpos($html, 'N·m') !== false && strpos($html, '13000') !== false, 'Existing units preserved');
    check($language === 'cn' || strpos($html, '最大扭矩') === false, 'Existing localized labels preserved');
    check(trim(file_get_contents($root . '/template/' . $language . '/html/comm/home_product_specs.html')) === '[list:product_specs]', 'All language includes use common tag');
}
echo "PASS: 0/1/2/3/4 properties, zero, unknown fields, order, exclusions, escaping and 10 languages\n";
