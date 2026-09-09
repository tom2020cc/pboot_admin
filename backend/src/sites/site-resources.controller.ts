import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';
import { SiteResourcesService } from './site-resources.service';

export class CleanSiteResourcesDto {
  @IsUUID() scanId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique()
  @IsString({ each: true }) @MaxLength(1024, { each: true }) paths: string[];
}

@Controller('sites/current/resources')
export class SiteResourcesController {
  constructor(private readonly resources: SiteResourcesService) {}
  @Post('scan') scan() { return this.resources.scan(); }
  @Post('clean') clean(@Body() body: CleanSiteResourcesDto) { return this.resources.clean(body.scanId, body.paths); }
  @Get('history') history() { return this.resources.history(); }
  @Post('restore/:id') restore(@Param('id') id: string) { return this.resources.restore(id); }
}
