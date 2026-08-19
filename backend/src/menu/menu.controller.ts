import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { TranslateMenuDto } from './dto/translate-menu.dto';

@Controller('menus')
@ApiTags('菜单管理')
export class MenuController {
  constructor(private readonly menusService: MenuService) {}

  @ApiOperation({ summary: '增加菜单栏目', description: '添加一个栏目信息' })
  @ApiBody({ type: CreateMenuDto, description: '输入菜单栏目信息' })
  @Post()
  create(@Body() postObj: CreateMenuDto) {
    return this.menusService.create(postObj);
  }

  @ApiOperation({ summary: '获取菜单栏目', description: '获取所有菜单栏目' })
  @Get()
  findAll() {
    return this.menusService.findAll();
  }

  @Get('translation-models')
  findTranslationModels() {
    return this.menusService.findTranslationModels();
  }

  @Post('translate-all')
  translateAll(@Body() body: TranslateMenuDto) {
    return this.menusService.translateAllFromChinese(body);
  }

  @ApiOperation({
    summary: '从 PbootCMS 同步栏目',
    description: '同步所有语言的栏目基础信息，不同步模型、列表模板、详情模板等字段',
  })
  @Post('pboot-sync')
  syncFromPboot() {
    return this.menusService.syncFromPboot();
  }

  @Post('pboot-repair-models')
  repairLocalModelsFromPboot() {
    return this.menusService.repairLocalModelsFromPboot();
  }

  @Post('pboot-sync-all')
  syncAllToPboot() {
    return this.menusService.syncAllToPboot();
  }

  @ApiOperation({
    summary: '同步单个栏目到 PbootCMS',
    description: '把当前后台栏目基础设置写回网站数据库，不同步模型、列表模板、详情模板等字段',
  })
  @ApiParam({ name: 'id', description: '本地栏目 ID', required: true, example: 499 })
  @Post(':id/pboot-sync')
  syncOneToPboot(@Param('id') id: string) {
    return this.menusService.syncOneToPboot(id);
  }

  @ApiOperation({ summary: '获取一条栏目信息', description: '根据 id 获取该栏目信息' })
  @ApiParam({ name: 'id', description: 'ID', required: true, example: 226 })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.menusService.findOneById(id);
  }

  @ApiOperation({ summary: '修改一条栏目信息', description: '根据 id 修改栏目信息' })
  @ApiParam({ name: 'id', description: 'ID', required: true, example: 698 })
  @Patch(':id')
  update(@Param('id') id: string, @Body() postObj: UpdateMenuDto) {
    return this.menusService.update(id, postObj);
  }

  @ApiOperation({ summary: '删除栏目', description: '根据 id 删除一条栏目信息' })
  @ApiParam({ name: 'id', description: 'ID', required: true, example: 222 })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.menusService.remove(id);
  }
}
