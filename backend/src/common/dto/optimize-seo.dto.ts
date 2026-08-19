import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class OptimizeSeoDto {
  @ApiProperty({ description: 'AI model used for Chinese SEO optimization' })
  @IsString()
  model: string;

  @ApiProperty({ description: 'Content type', enum: ['news', 'product'] })
  @IsString()
  @IsIn(['news', 'product'])
  contentType: 'news' | 'product';

  @ApiProperty({ description: 'Simplified Chinese title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Simplified Chinese subtitle', required: false })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiProperty({ description: 'Simplified Chinese SEO keywords', required: false })
  @IsString()
  @IsOptional()
  keywords?: string;

  @ApiProperty({ description: 'Current URL name; AI only generates one when empty', required: false })
  @IsString()
  @IsOptional()
  urlName?: string;

  @ApiProperty({ description: 'Simplified Chinese SEO description', required: false })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiProperty({ description: 'Simplified Chinese HTML content', required: false })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({ description: 'Simplified Chinese carousel image titles', type: [String], required: false })
  @IsArray()
  @IsOptional()
  carouselTitles?: string[];

  @ApiProperty({ description: 'Only fill missing image ALTs, keep all other fields untouched', required: false })
  @IsBoolean()
  @IsOptional()
  onlyAlts?: boolean;
}
