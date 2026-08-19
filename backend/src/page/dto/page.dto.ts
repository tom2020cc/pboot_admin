import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class PageTranslationDto {
  @IsString()
  lang: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  urlName?: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  @IsOptional()
  keywords?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  content?: string;
}

export class SavePageDto {
  @IsNumber()
  menuId: number;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  urlName?: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  @IsOptional()
  keywords?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  show?: boolean;

  @IsNumber()
  @IsOptional()
  orderNum?: number;

  @IsArray()
  @IsOptional()
  translations?: PageTranslationDto[];
}

export class SyncPageDto {
  @IsString()
  @IsOptional()
  lang?: string;

  @IsBoolean()
  @IsOptional()
  all?: boolean;
}
