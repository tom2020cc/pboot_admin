import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { SyncProductDto } from './dto/sync-product.dto';
import { TranslateProductDto } from './dto/translate-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { OptimizeSeoDto } from '../common/dto/optimize-seo.dto';
import { TranslateMenuContentDto } from '../common/dto/translate-menu-content.dto';
import { PbootScopeDto } from '../common/dto/pboot-scope.dto';

@Controller('products')
@ApiTags('产品管理')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @ApiOperation({ summary: '新增产品', description: '添加一个产品内容' })
  @ApiBody({ type: CreateProductDto, description: '输入产品内容' })
  @Post()
  create(@Body() postObj: CreateProductDto) {
    return this.productService.create(postObj);
  }

  @ApiOperation({ summary: '获取产品语言列表' })
  @Get('languages')
  findLanguages() {
    return this.productService.findLanguages();
  }

  @ApiOperation({ summary: '获取可选产品翻译模型' })
  @Get('translation-models')
  findTranslationModels() {
    return this.productService.findTranslationModels();
  }

  @ApiOperation({ summary: '生成产品翻译草稿' })
  @ApiBody({ type: TranslateProductDto })
  @Post('translate-draft')
  translateDraft(@Body() postObj: TranslateProductDto) {
    return this.productService.translateDraft(postObj);
  }

  @ApiOperation({ summary: '按栏目批量翻译产品', description: '以目标语言栏目为范围，从对应中文栏目逐条生成目标语言内容' })
  @ApiBody({ type: TranslateMenuContentDto })
  @Post('translate-menu')
  translateMenu(@Body() postObj: TranslateMenuContentDto) {
    return this.productService.startMenuTranslation(postObj);
  }

  @ApiOperation({ summary: '获取产品栏目翻译任务进度' })
  @Get('translate-menu/:jobId')
  findMenuTranslationJob(@Param('jobId') jobId: string) {
    return this.productService.findMenuTranslationJob(jobId);
  }

  @ApiOperation({ summary: '重试产品栏目翻译失败项' })
  @Post('translate-menu/:jobId/retry')
  retryMenuTranslationJob(@Param('jobId') jobId: string, @Body() postObj: { model: string }) {
    return this.productService.retryMenuTranslationFailures(jobId, postObj.model);
  }

  @ApiOperation({ summary: 'Stop product menu translation job' })
  @Post('translate-menu/:jobId/cancel')
  cancelMenuTranslationJob(@Param('jobId') jobId: string) {
    return this.productService.cancelMenuTranslationJob(jobId);
  }

  @ApiOperation({ summary: 'AI 优化中文产品 SEO', description: '只优化当前中文草稿；URL 为空时生成语义化名称，已有 URL、图片地址和其他语言不修改' })
  @ApiBody({ type: OptimizeSeoDto })
  @Post('optimize-seo')
  optimizeSeo(@Body() postObj: OptimizeSeoDto) {
    return this.productService.optimizeSeoDraft({ ...postObj, contentType: 'product' });
  }

  @ApiOperation({ summary: '获取产品列表', description: '获取所有产品，可按栏目ID筛选' })
  @ApiQuery({ name: 'menuId', required: false, description: '内容栏目ID' })
  @ApiQuery({ name: 'lang', required: false, description: '语言代码，例如 zh-CN、en、es' })
  @Get()
  findAll(@Query('menuId') menuId?: string, @Query('lang') lang?: string) {
    return this.productService.findAll(menuId ? Number(menuId) : undefined, lang);
  }

  @ApiOperation({ summary: '获取产品同步统计' })
  @ApiQuery({ name: 'menuId', required: false, description: '内容栏目 ID' })
  @ApiQuery({ name: 'lang', required: false, description: '语言代码，例如 zh-CN、en、es' })
  @Get('pboot-stats')
  findPbootStats(@Query('menuId') menuId?: string, @Query('lang') lang?: string) {
    return this.productService.getPbootStats(menuId ? Number(menuId) : undefined, lang);
  }

  @ApiOperation({ summary: '获取一个产品', description: '根据id获取产品详情' })
  @ApiParam({ name: 'id', description: '产品ID', required: true })
  @ApiQuery({ name: 'lang', required: false, description: '语言代码，例如 zh-CN、en、es' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Query('lang') lang?: string) {
    return this.productService.findOneById(id, lang);
  }

  @ApiOperation({ summary: '同步产品到 PbootCMS 网站' })
  @ApiParam({ name: 'id', description: '产品ID', required: true })
  @ApiBody({ type: SyncProductDto, required: false })
  @Post(':id/pboot-sync')
  syncToPboot(@Param('id', ParseIntPipe) id: number, @Body() postObj: SyncProductDto) {
    return this.productService.syncToPboot(id, postObj);
  }

  @ApiOperation({ summary: '全量同步产品到 PbootCMS 网站', description: '删除旧的 vue-product-* 记录后，重新同步后台全部产品和全部语言' })
  @Post('pboot-sync-all')
  syncAllToPboot() {
    return this.productService.syncAllToPboot();
  }

  @ApiOperation({ summary: '从 PbootCMS 覆盖导入产品', description: '备份当前本地库后，删除当前产品数据并从 PbootCMS 网站数据库重新导入' })
  @Post('pboot-import')
  importFromPboot() {
    return this.productService.importFromPboot();
  }

  @ApiOperation({ summary: 'Pull the current product menu and language from PbootCMS' })
  @ApiBody({ type: PbootScopeDto })
  @Post('pboot-scope/pull')
  pullPbootScope(@Body() postObj: PbootScopeDto) {
    return this.productService.pullPbootScope(postObj.menuId, postObj.lang);
  }

  @ApiOperation({ summary: 'Overwrite the current product menu and language in PbootCMS' })
  @ApiBody({ type: PbootScopeDto })
  @Post('pboot-scope/push')
  pushPbootScope(@Body() postObj: PbootScopeDto) {
    return this.productService.pushPbootScope(postObj.menuId, postObj.lang);
  }

  @ApiOperation({ summary: '修改产品', description: '根据id修改产品内容' })
  @ApiParam({ name: 'id', description: '产品ID', required: true })
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() postObj: UpdateProductDto) {
    return this.productService.update(id, postObj);
  }

  @ApiOperation({ summary: '删除产品', description: '根据id删除一个产品' })
  @ApiParam({ name: 'id', description: '产品ID', required: true })
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productService.remove(id);
  }
}
