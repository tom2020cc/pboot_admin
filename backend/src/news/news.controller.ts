import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NewsService } from './news.service';
import { CreateNewsDto } from './dto/create-news.dto';
import { SyncNewsDto } from './dto/sync-news.dto';
import { TranslateNewsDto } from './dto/translate-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { OptimizeSeoDto } from '../common/dto/optimize-seo.dto';
import { TranslateMenuContentDto } from '../common/dto/translate-menu-content.dto';
import { PbootScopeDto } from '../common/dto/pboot-scope.dto';

@Controller('news')
@ApiTags('新闻管理')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @ApiOperation({ summary: '新增新闻', description: '添加一篇新闻内容，可同时提交多语言内容' })
  @ApiBody({ type: CreateNewsDto, description: '输入新闻内容' })
  @Post()
  create(@Body() postObj: CreateNewsDto) {
    return this.newsService.create(postObj);
  }

  @ApiOperation({ summary: '获取新闻语言列表' })
  @Get('languages')
  findLanguages() {
    return this.newsService.findLanguages();
  }

  @ApiOperation({ summary: '获取可选翻译模型' })
  @Get('translation-models')
  findTranslationModels() {
    return this.newsService.findTranslationModels();
  }

  @ApiOperation({ summary: '生成新闻翻译草稿', description: '根据中文内容生成目标语言翻译，第一版先支持英文' })
  @ApiBody({ type: TranslateNewsDto })
  @Post('translate-draft')
  translateDraft(@Body() postObj: TranslateNewsDto) {
    return this.newsService.translateDraft(postObj);
  }

  @ApiOperation({ summary: '按栏目批量翻译新闻', description: '以目标语言栏目为范围，从对应中文栏目逐条生成目标语言内容' })
  @ApiBody({ type: TranslateMenuContentDto })
  @Post('translate-menu')
  translateMenu(@Body() postObj: TranslateMenuContentDto) {
    return this.newsService.startMenuTranslation(postObj);
  }

  @ApiOperation({ summary: '获取新闻栏目翻译任务进度' })
  @Get('translate-menu/:jobId')
  findMenuTranslationJob(@Param('jobId') jobId: string) {
    return this.newsService.findMenuTranslationJob(jobId);
  }

  @ApiOperation({ summary: '重试新闻栏目翻译失败项' })
  @Post('translate-menu/:jobId/retry')
  retryMenuTranslationJob(@Param('jobId') jobId: string, @Body() postObj: { model: string }) {
    return this.newsService.retryMenuTranslationFailures(jobId, postObj.model);
  }

  @ApiOperation({ summary: 'Stop news menu translation job' })
  @Post('translate-menu/:jobId/cancel')
  cancelMenuTranslationJob(@Param('jobId') jobId: string) {
    return this.newsService.cancelMenuTranslationJob(jobId);
  }

  @ApiOperation({ summary: 'AI 优化中文新闻 SEO', description: '只优化当前中文草稿；URL 为空时生成语义化名称，已有 URL 和其他语言不修改' })
  @ApiBody({ type: OptimizeSeoDto })
  @Post('optimize-seo')
  optimizeSeo(@Body() postObj: OptimizeSeoDto) {
    return this.newsService.optimizeSeoDraft({ ...postObj, contentType: 'news' });
  }

  @ApiOperation({ summary: '获取新闻列表', description: '获取所有新闻，可按栏目和语言筛选' })
  @ApiQuery({ name: 'menuId', required: false, description: '内容栏目 ID' })
  @ApiQuery({ name: 'lang', required: false, description: '语言代码，例如 zh-CN、en、es' })
  @Get()
  findAll(@Query('menuId') menuId?: string, @Query('lang') lang?: string) {
    return this.newsService.findAll(menuId ? Number(menuId) : undefined, lang);
  }

  @ApiOperation({ summary: '获取新闻同步统计' })
  @ApiQuery({ name: 'menuId', required: false, description: '内容栏目 ID' })
  @ApiQuery({ name: 'lang', required: false, description: '语言代码，例如 zh-CN、en、es' })
  @Get('pboot-stats')
  findPbootStats(@Query('menuId') menuId?: string, @Query('lang') lang?: string) {
    return this.newsService.getPbootStats(menuId ? Number(menuId) : undefined, lang);
  }

  @ApiOperation({ summary: '获取一篇新闻', description: '根据 id 获取新闻详情，可按语言返回标题、描述和正文' })
  @ApiParam({ name: 'id', description: '新闻 ID', required: true })
  @ApiQuery({ name: 'lang', required: false, description: '语言代码，例如 zh-CN、en、es' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Query('lang') lang?: string) {
    return this.newsService.findOneById(id, lang);
  }

  @ApiOperation({ summary: '补齐新闻多语言', description: '为已有新闻补齐 7 种语言记录' })
  @ApiParam({ name: 'id', description: '新闻 ID', required: true })
  @Post(':id/translate')
  translate(@Param('id', ParseIntPipe) id: number) {
    return this.newsService.translate(id);
  }

  @ApiOperation({ summary: '同步新闻到 PbootCMS 网站', description: '将当前后台新闻写入 phpStudy 站点的 PbootCMS SQLite 数据库' })
  @ApiParam({ name: 'id', description: '新闻 ID', required: true })
  @ApiBody({ type: SyncNewsDto, required: false })
  @Post(':id/pboot-sync')
  syncToPboot(@Param('id', ParseIntPipe) id: number, @Body() postObj: SyncNewsDto) {
    return this.newsService.syncToPboot(id, postObj);
  }

  @ApiOperation({ summary: '全量同步新闻到 PbootCMS 网站', description: '删除旧的 vue-news-* 记录后，重新同步后台全部新闻和全部语言' })
  @Post('pboot-sync-all')
  syncAllToPboot() {
    return this.newsService.syncAllToPboot();
  }

  @ApiOperation({ summary: '从 PbootCMS 覆盖导入新闻', description: '备份当前本地库后，删除当前新闻数据并从 PbootCMS 网站数据库重新导入' })
  @Post('pboot-import')
  importFromPboot() {
    return this.newsService.importFromPboot();
  }

  @ApiOperation({ summary: 'Pull the selected news menu and language from PbootCMS' })
  @ApiBody({ type: PbootScopeDto })
  @Post('pboot-scope/pull')
  pullPbootScope(@Body() postObj: PbootScopeDto) {
    return this.newsService.pullPbootScope(postObj.menuId, postObj.lang);
  }

  @ApiOperation({ summary: 'Overwrite the selected news menu and language in PbootCMS' })
  @ApiBody({ type: PbootScopeDto })
  @Post('pboot-scope/push')
  pushPbootScope(@Body() postObj: PbootScopeDto) {
    return this.newsService.pushPbootScope(postObj.menuId, postObj.lang);
  }

  @ApiOperation({ summary: '修改新闻', description: '根据 id 修改新闻内容和多语言内容' })
  @ApiParam({ name: 'id', description: '新闻 ID', required: true })
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() postObj: UpdateNewsDto) {
    return this.newsService.update(id, postObj);
  }

  @ApiOperation({ summary: '删除新闻', description: '根据 id 删除一篇新闻' })
  @ApiParam({ name: 'id', description: '新闻 ID', required: true })
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.newsService.remove(id);
  }
}
