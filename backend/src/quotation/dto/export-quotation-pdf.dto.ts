import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class ExportQuotationPdfDto {
  @Type(() => Number)
  @IsNumber()
  @Min(180)
  @Max(420)
  widthMm: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(600)
  heightMm: number;
}
