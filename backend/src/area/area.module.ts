import { Module } from '@nestjs/common';
import { AreaController } from './area.controller';
import { AreaService } from './area.service';
import { SitesModule } from '../sites/sites.module';
import { AreaProgramService } from './area-program.service';

@Module({
  imports: [SitesModule],
  controllers: [AreaController],
  providers: [AreaService, AreaProgramService],
  exports: [AreaService],
})
export class AreaModule {}
