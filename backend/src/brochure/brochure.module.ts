import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brochure } from './brochure.entity';
import { BrochureController } from './brochure.controller';
import { BrochureService } from './brochure.service';
import { BrochurePdfService } from './brochure-pdf.service';

@Module({ imports: [TypeOrmModule.forFeature([Brochure])], controllers: [BrochureController], providers: [BrochureService, BrochurePdfService] })
export class BrochureModule {}
