import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class OptimizeMenuSeoDto {
  @ApiProperty()
  @IsString()
  model: string;

  @ApiProperty({ enum: ['cn'] })
  @IsIn(['cn'])
  lang: 'cn';

  @IsOptional()
  @IsString()
  menuId?: string;

  @ApiProperty({ description: '中文栏目名称' })
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  parentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  seoKeywords?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  seoDescription?: string;
}
