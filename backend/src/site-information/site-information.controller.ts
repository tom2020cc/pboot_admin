import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { SiteInformationService } from './site-information.service';
import { InformationRevisionDto, RemoteInformationDto, SaveInformationDto, SetupInformationDto, SyncInformationDto, TranslateInformationDto } from './site-information.dto';

@Controller('site-information')
export class SiteInformationController {
  constructor(private readonly service: SiteInformationService) {}
  @Get() read() { return this.service.read(); }
  @Get('models') models() { return this.service.models(); }
  @Get('setup') previewSetup() { return this.service.previewSetup(); }
  @Post('setup') setup(@Body() dto: SetupInformationDto) { return this.service.setup(dto); }
  @Post('save') save(@Body() dto: SaveInformationDto) { return this.service.save(dto); }
  @Post('import') import(@Body() dto: InformationRevisionDto) { return this.service.import(dto); }
  @Post('translate') translate(@Body() dto: TranslateInformationDto) { return this.service.translate(dto); }
  @Post('sync') sync(@Body() dto: SyncInformationDto) { return this.service.sync(dto); }
  @Post('sync-online') @Header('Cache-Control', 'no-store') syncOnline(@Body() dto: RemoteInformationDto) { return this.service.syncOnline(dto); }
}
