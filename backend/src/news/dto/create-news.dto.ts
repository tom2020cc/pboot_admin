import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class NewsTranslationDto {
  @ApiProperty({ description: 'Language code', example: 'en' })
  @IsString()
  lang: string;

  @ApiProperty({ description: 'Title', example: 'Domestic Chinese Clients Visit Factory', required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ description: 'URL name', required: false })
  @IsString()
  @IsOptional()
  urlName?: string;

  @ApiProperty({ description: 'Subtitle', required: false })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiProperty({ description: 'SEO keywords', required: false })
  @IsString()
  @IsOptional()
  keywords?: string;

  @ApiProperty({ description: 'SEO description', required: false })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiProperty({ description: 'HTML content', example: '<p>News content</p>', required: false })
  @IsString()
  @IsOptional()
  content?: string;
}

export class CreateNewsDto {
  @ApiProperty({ description: 'Menu ID', example: 1 })
  @IsNumber()
  menuId: number;

  @ApiProperty({ description: 'Title', example: 'Domestic Chinese Clients Visit Factory' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'URL name', example: 'domestic-clients-visit-factory', required: false })
  @IsString()
  @IsOptional()
  urlName: string;

  @ApiProperty({ description: 'Subtitle', required: false })
  @IsString()
  @IsOptional()
  subtitle: string;

  @ApiProperty({ description: 'SEO keywords', required: false })
  @IsString()
  @IsOptional()
  keywords: string;

  @ApiProperty({ description: 'Thumbnail', example: '13023033.jpg', required: false })
  @IsString()
  @IsOptional()
  thumbnail: string;

  @ApiProperty({ description: 'SEO description', required: false })
  @IsString()
  @IsOptional()
  summary: string;

  @ApiProperty({ description: 'HTML content', example: '<p>News content</p>', required: false })
  @IsString()
  @IsOptional()
  content: string;

  @ApiProperty({ description: 'Author', example: 'admin', required: false })
  @IsString()
  @IsOptional()
  author: string;

  @ApiProperty({ description: 'Source', example: 'Official site', required: false })
  @IsString()
  @IsOptional()
  source: string;

  @ApiProperty({ description: 'Visible status', example: true, required: false })
  @IsBoolean()
  @IsOptional()
  show: boolean;

  @ApiProperty({ description: 'Sort order', example: 0, required: false })
  @IsNumber()
  @IsOptional()
  orderNum: number;

  @ApiProperty({ description: 'Translations', type: [NewsTranslationDto], required: false })
  @IsArray()
  @IsOptional()
  translations?: NewsTranslationDto[];
}
