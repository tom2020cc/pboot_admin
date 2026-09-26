import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteInformationDraft } from './site-information.entity';
import { SiteInformationController } from './site-information.controller';
import { SiteInformationService } from './site-information.service';
import { SiteInformationTranslator } from './site-information-translator.service';

@Module({ imports: [TypeOrmModule.forFeature([SiteInformationDraft])], controllers: [SiteInformationController],
  providers: [SiteInformationService, SiteInformationTranslator] })
export class SiteInformationModule {}
