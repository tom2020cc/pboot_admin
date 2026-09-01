import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateQuotationDto {
  @ApiProperty({ example: 'BJ-20260829-01' })
  @IsString()
  @MaxLength(80)
  quotationNo: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  customerCompany?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  customerContact?: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(20)
  currency: string;

  @ApiProperty({ example: 69000 })
  @IsNumber()
  @Min(0)
  total: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  itemCount: number;

  @ApiProperty({ example: '2026-08-29' })
  @IsString()
  @MaxLength(20)
  quotationDate: string;

  @ApiProperty({ description: 'Complete quotation draft' })
  @IsObject()
  data: Record<string, unknown>;
}
