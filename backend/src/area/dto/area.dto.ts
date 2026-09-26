import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAreaDto {
  @ApiProperty({ description: '区域编码，两位小写字母', example: 'en' })
  @IsString()
  @IsNotEmpty({ message: '请填写区域编码' })
  @Matches(/^[a-z]{2}$/, { message: '区域编码必须是两位小写字母，例如 cn、en、ar' })
  acode: string;

  @ApiProperty({ description: '区域名称', example: '英文' })
  @IsString()
  @IsNotEmpty({ message: '请填写区域名称' })
  @MaxLength(50, { message: '区域名称不能超过 50 个字符' })
  name: string;

  @ApiPropertyOptional({ description: '绑定域名，留空表示不绑定', example: 'en.example.com' })
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: '域名不能超过 100 个字符' })
  domain?: string;
}

export class UpdateAreaDto {
  @ApiPropertyOptional({ description: '区域名称' })
  @IsString()
  @IsOptional()
  @MaxLength(50, { message: '区域名称不能超过 50 个字符' })
  name?: string;

  @ApiPropertyOptional({ description: '绑定域名' })
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: '域名不能超过 100 个字符' })
  domain?: string;
}

export class BatchDeleteAreasDto {
  @ApiProperty({ description: '区域 ID 列表', type: [Number] })
  @IsArray({ message: 'ids 必须是数组' })
  @IsInt({ each: true, message: 'ids 只能包含整数' })
  @Type(() => Number)
  ids: number[];
}

export class SearchAreasDto {
  @ApiPropertyOptional({ description: '搜索区域名称、编码或域名' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '页码', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  page?: number;

  @ApiPropertyOptional({ description: '每页数量', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  limit?: number;
}
