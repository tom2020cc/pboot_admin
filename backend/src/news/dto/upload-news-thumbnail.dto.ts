import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UploadNewsThumbnailDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  newsId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  menuId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referenceImage?: string;
}
