import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { ProductSharedParameters } from '../product-shared-parameters';

export class ProductTranslationDto {
  @ApiProperty({ description: 'Language code', example: 'en' })
  @IsString()
  lang: string;

  @ApiProperty({ description: 'Product title', required: false })
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

  @ApiProperty({ description: 'Product HTML content', required: false })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({ description: 'Carousel image titles', type: [String], required: false })
  @IsArray()
  @IsOptional()
  carouselTitles?: string[];
}

export class CreateProductDto {
  @ApiProperty({ description: 'Shared technical parameters and internal reference price', required: false, nullable: true })
  @IsObject()
  @IsOptional()
  sharedParameters?: ProductSharedParameters | null;

  @ApiProperty({ description: 'Menu ID', example: 1 })
  @IsNumber()
  menuId: number;

  @ApiProperty({ description: 'Product title', example: '125HP bulldozer' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'URL name', example: 'sd46-bulldozer', required: false })
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

  @ApiProperty({ description: 'Product large image', required: false })
  @IsString()
  @IsOptional()
  largeImage: string;

  @ApiProperty({ description: 'Product video URL', required: false })
  @IsString()
  @IsOptional()
  videoUrl: string;

  @ApiProperty({ description: 'Carousel images', example: ['1.jpg', '2.jpg'], required: false })
  @IsArray()
  @IsOptional()
  carouselImages: string[];

  @ApiProperty({ description: 'Carousel image titles', example: ['125HP bulldozer', 'small bulldozer'], required: false })
  @IsArray()
  @IsOptional()
  carouselTitles: string[];

  @ApiProperty({ description: 'SEO description', example: 'Product SEO description', required: false })
  @IsString()
  @IsOptional()
  summary: string;

  @ApiProperty({ description: 'Product detail', example: '<p>Product detail</p>', required: false })
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

  @ApiProperty({ description: 'Translations', type: [ProductTranslationDto], required: false })
  @IsArray()
  @IsOptional()
  translations?: ProductTranslationDto[];
}
