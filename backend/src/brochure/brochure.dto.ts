import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsInt, IsString, Matches, MaxLength, Min, ValidateNested, IsDefined } from 'class-validator';

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
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => BrochureSpecDto)
  specs: BrochureSpecDto[];
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => BrochureImageDto)
  images: BrochureImageDto[];
}

export class BrochureDataDto {
  @Equals(1) version: number;
  @IsIn(['zh-CN', 'en']) language: string;
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
