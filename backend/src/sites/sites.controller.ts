import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { DiscoverManagedSitesDto, SaveManagedSiteDto, SaveSharedSiteSettingsDto, UpdateManagedSiteDto } from './dto/site.dto';
import { SitesService } from './sites.service';

@Controller('sites')
@ApiTags('站点管理')
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  @ApiOperation({ summary: '站点列表' })
  findAll() {
    return this.sitesService.findAll();
  }

  @Get('static-file')
  @Public()
  @ApiOperation({ summary: '读取指定站点 static 目录文件' })
  staticFile(
    @Query('siteId', ParseIntPipe) siteId: number,
    @Query('path') relativePath: string,
    @Res() response: Response,
  ) {
    return response.sendFile(this.sitesService.resolveStaticFile(siteId, relativePath));
  }

  @Get('current')
  @ApiOperation({ summary: '当前请求使用的站点' })
  current() {
    return this.sitesService.getCurrentSite();
  }

  @Get('current/languages')
  @ApiOperation({ summary: '读取当前 PbootCMS 站点已配置的语言区域' })
  currentLanguages() {
    return this.sitesService.getCurrentSiteLanguages();
  }

  @Get('current/profile')
  @ApiOperation({ summary: '读取当前 PbootCMS 站点的公司与报价抬头资料' })
  currentProfile() {
    return this.sitesService.getCurrentSiteProfile();
  }

  @Get('shared-settings')
  @ApiOperation({ summary: '读取全站共享配置状态' })
  sharedSettings() {
    return this.sitesService.getSharedSettings();
  }

  @Post('shared-settings')
  @ApiOperation({ summary: '保存全站共享配置' })
  saveSharedSettings(@Body() body: SaveSharedSiteSettingsDto) {
    return this.sitesService.saveSharedSettings(body);
  }

  @Post()
  @ApiOperation({ summary: '新增站点' })
  create(@Body() body: SaveManagedSiteDto) {
    return this.sitesService.create(body);
  }

  @Post('discover')
  @ApiOperation({ summary: '扫描父目录中的 PbootCMS 网站' })
  discover(@Body() body: DiscoverManagedSitesDto) {
    return this.sitesService.discover(body);
  }

  @Post('check-all')
  @ApiOperation({ summary: '批量检查全部站点' })
  checkAll() {
    return this.sitesService.checkAll();
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改站点' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateManagedSiteDto) {
    return this.sitesService.update(id, body);
  }

  @Post(':id/default')
  @ApiOperation({ summary: '设为默认站点' })
  setDefault(@Param('id', ParseIntPipe) id: number) {
    return this.sitesService.setDefault(id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: '检查站点目录与数据库' })
  test(@Param('id', ParseIntPipe) id: number) {
    return this.sitesService.test(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除站点' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sitesService.remove(id);
  }
}
