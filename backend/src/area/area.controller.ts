import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AreaService } from './area.service';
import { BatchDeleteAreasDto, CreateAreaDto, SearchAreasDto, UpdateAreaDto } from './dto/area.dto';
import { AreaProgramService } from './area-program.service';
import { AreaProgramSiteDto, RepairAreaProgramDto } from './dto/area-program.dto';

@Controller('areas')
@ApiTags('区域管理')
export class AreaController {
  constructor(private readonly areaService: AreaService, private readonly areaProgram: AreaProgramService) {}

  @Get()
  @ApiOperation({ summary: '区域列表' })
  findAll(@Query() query: SearchAreasDto) {
    return this.areaService.findAll(query.search, query.page, query.limit);
  }

  @Post()
  @ApiOperation({ summary: '新增区域' })
  create(@Body() body: CreateAreaDto) {
    return this.areaService.create(body);
  }

  @Post('batch-delete')
  @ApiOperation({ summary: '批量删除区域' })
  batchDelete(@Body() body: BatchDeleteAreasDto) {
    return this.areaService.batchDelete(body.ids);
  }

  @Get('program-repair')
  @ApiOperation({ summary: '预览当前网站的 PB 域名识别修复' })
  previewProgram(@Query() query: AreaProgramSiteDto) {
    return this.areaProgram.preview(query.siteId);
  }

  @Post('program-repair')
  @ApiOperation({ summary: '修复本地 PB 域名识别，并按选择同步线上程序' })
  repairProgram(@Body() body: RepairAreaProgramDto) {
    return this.areaProgram.apply(body);
  }

  @Get(':id')
  @ApiOperation({ summary: '区域详情' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.areaService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '修改区域' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateAreaDto) {
    return this.areaService.update(id, body);
  }

  @Post(':id/default')
  @ApiOperation({ summary: '设为默认区域' })
  setDefault(@Param('id', ParseIntPipe) id: number) {
    return this.areaService.setDefault(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除区域' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.areaService.remove(id);
  }
}
