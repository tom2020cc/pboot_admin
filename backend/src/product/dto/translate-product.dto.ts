import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class TranslateProductDto {
  @ApiProperty({ description: 'Source language', example: 'zh-CN', required: false })
  @IsString()
  @IsOptional()
  sourceLang?: string;

  @ApiProperty({ description: 'Target language', example: 'en' })
  @IsString()
  @IsIn(['en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'])
  targetLang: string;

  @ApiProperty({ description: 'Translation model', example: 'glm-4.7-flash' })
  @IsString()
  model: string;

  @ApiProperty({ description: 'Source title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Source subtitle', required: false })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiProperty({ description: 'Source SEO keywords', required: false })
  @IsString()
  @IsOptional()
  keywords?: string;

  @ApiProperty({ description: 'Source SEO description', required: false })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiProperty({ description: 'Source detail HTML', required: false })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({ description: 'Source carousel titles', type: [String], required: false })
  @IsArray()
  @IsOptional()
  carouselTitles?: string[];
}
