import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { SavePageDto, SyncPageDto } from './dto/page.dto';
import { PageService } from './page.service';
import { TranslateNewsDto } from '../news/dto/translate-news.dto';

@Controller('pages')
export class PageController {
  constructor(private readonly pageService: PageService) {}

  @Get('languages')
  findLanguages() {
    return this.pageService.findLanguages();
  }

  @Get('translation-models')
  findTranslationModels() {
    return this.pageService.findTranslationModels();
  }

  @Post('translate-draft')
  translateDraft(@Body() body: TranslateNewsDto) {
    return this.pageService.translateDraft(body);
  }

  @Get()
  findAll(@Query('menuId') menuId?: string, @Query('lang') lang?: string) {
    return this.pageService.findAll(menuId ? Number(menuId) : undefined, lang);
  }

  @Post()
  create(@Body() body: SavePageDto) {
    return this.pageService.create(body);
  }

  @Post('pboot-import')
  importFromPboot() {
    return this.pageService.importFromPboot();
  }

  @Post('pboot-sync-all')
  syncAllToPboot() {
    return this.pageService.syncAllToPboot();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Query('lang') lang?: string) {
    return this.pageService.findOneById(id, lang);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: SavePageDto) {
    return this.pageService.update(id, body);
  }

  @Post(':id/pboot-sync')
  syncToPboot(@Param('id', ParseIntPipe) id: number, @Body() body: SyncPageDto) {
    return this.pageService.syncToPboot(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.pageService.remove(id);
  }
}
