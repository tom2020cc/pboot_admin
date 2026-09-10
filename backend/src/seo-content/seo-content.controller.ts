import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { SeoContentService } from './seo-content.service';
import {
  QueueDto,
  SaveDraftDto,
  SavePlanDto,
  ScheduleDto,
  SourceDto,
  SwitchDto,
} from './seo-content.dto';
@Controller('seo-content')
export class SeoContentController {
  constructor(private readonly service: SeoContentService) {}
  @Get() state() {
    return this.service.state();
  }
  @Get('articles/:id/history') history(@Param('id', ParseIntPipe) id: number) {
    return this.service.history(id);
  }
  @Patch('plan') plan(@Body() body: SavePlanDto) {
    return this.service.savePlan(body);
  }
  @Post('switch') siteSwitch(@Body() body: SwitchDto) {
    return this.service.switchSite(body.enabled);
  }
  @Post('global-switch') globalSwitch(@Body() body: SwitchDto) {
    return this.service.switchGlobal(body.enabled);
  }
  @Post('sources') source(@Body() body: SourceDto) {
    return this.service.saveSource(body);
  }
  @Patch('sources/:id') editSource(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SourceDto,
  ) {
    return this.service.saveSource(body, id);
  }
  @Post('jobs') queue(@Body() body: QueueDto) {
    return this.service.queue(body);
  }
  @Patch('jobs/:id/draft') draft(
    @Param('id') id: string,
    @Body() body: SaveDraftDto,
  ) {
    return this.service.saveDraft(id, body);
  }
  @Post('jobs/:id/check') check(
    @Param('id') id: string,
    @Body() body: SaveDraftDto,
  ) {
    return this.service.check(id, body);
  }
  @Post('jobs/:id/schedule') schedule(
    @Param('id') id: string,
    @Body() body: ScheduleDto,
  ) {
    return this.service.schedule(id, body);
  }
  @Post('jobs/:id/cancel') cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
  @Post('jobs/:id/retry') retry(@Param('id') id: string) {
    return this.service.retry(id);
  }
}
