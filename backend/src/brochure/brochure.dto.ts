import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateNested, IsDefined, IsOptional, IsBoolean } from 'class-validator';
import { NEWS_LANGUAGES } from '../news/news-languages';

export class BrochureSpecDto {
  @IsString() @MaxLength(160) name: string;
  @IsString() @MaxLength(3000) value: string;
  @IsString() @MaxLength(40) unit: string;
}

export class BrochureImageDto {
  @IsString() @MaxLength(2048) src: string;
  @IsString() @MaxLength(300) caption: string;
}

export class BrochureProductDto {
  @IsString() @MaxLength(100) id: string;
  @IsInt() @Min(0) productId: number;
  @IsString() @Matches(/\S/) @MaxLength(200) title: string;
  @IsString() @MaxLength(300) subtitle: string;
  @IsString() @MaxLength(200) category: string;
  @IsString() @MaxLength(12000) description: string;
  @IsString() @MaxLength(6000) highlights: string;
  @IsOptional() @IsString() @MaxLength(300000) detailsHtml?: string;
  @IsOptional() @IsBoolean() detailsEnabled?: boolean;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BrochureSpecDto)
  specs: BrochureSpecDto[];
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => BrochureImageDto)
  images: BrochureImageDto[];
}

export class BrochureDataDto {
  @Equals(1) version: number;
  @IsIn(NEWS_LANGUAGES.map(item => item.code)) language: string;
  @IsOptional() @IsIn(['large', 'medium']) imageSize?: string;
  @IsOptional() @IsBoolean() newProductPage?: boolean;
  @IsOptional() @IsNumber() @Min(100) @Max(420) pageWidthMm?: number;
  @IsOptional() @IsNumber() @Min(100) @Max(600) pageHeightMm?: number;
  @IsOptional() @IsNumber() @Min(8) @Max(30) pageMarginMm?: number;
  @IsOptional() @IsIn(['sans', 'serif', 'mono']) fontFamily?: string;
  @IsOptional() @IsNumber() @Min(9) @Max(16) bodyFontSize?: number;
  @IsOptional() @IsNumber() @Min(12) @Max(24) headingFontSize?: number;
  @IsOptional() @IsNumber() @Min(1.2) @Max(2.2) lineHeight?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(16) paragraphSpacing?: number;
  @IsOptional() @IsNumber() @Min(8) @Max(14) tableFontSize?: number;
  @IsOptional() @IsIn(['compact', 'standard', 'relaxed']) tableDensity?: string;
  @IsOptional() @IsIn(['web', 'minimal', 'grid']) tableStyle?: string;
  @IsString() @Matches(/\S/) @MaxLength(200) title: string;
  @IsString() @MaxLength(300) subtitle: string;
  @IsString() @MaxLength(200) companyName: string;
  @IsString() @MaxLength(2048) logoUrl: string;
  @IsString() @MaxLength(500) website: string;
  @IsString() @MaxLength(100) contactName: string;
  @IsString() @MaxLength(100) phone: string;
  @IsString() @MaxLength(200) email: string;
  @IsString() @MaxLength(3000) notes: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BrochureProductDto)
  items: BrochureProductDto[];
}

export class SaveBrochureDto {
  @IsDefined() @ValidateNested() @Type(() => BrochureDataDto)
  data: BrochureDataDto;
}
