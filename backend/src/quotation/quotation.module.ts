import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation } from './entities/quotation.entity';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';
import { QuotationPdfService } from './quotation-pdf.service';

@Module({
  imports: [TypeOrmModule.forFeature([Quotation])],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationPdfService],
})
export class QuotationModule {}
