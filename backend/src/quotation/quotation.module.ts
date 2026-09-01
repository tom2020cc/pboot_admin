import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation } from './entities/quotation.entity';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Quotation])],
  controllers: [QuotationController],
  providers: [QuotationService],
})
export class QuotationModule {}
