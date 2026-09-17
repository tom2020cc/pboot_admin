import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ImportProductFolderDto {
  @ApiProperty({ description: '后台服务器上包含多个型号子文件夹的目录' })
  @IsString()
  sourceDirectory: string;

  @ApiProperty({ description: '目标中文产品栏目 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  menuId: number;

  @ApiProperty({ required: false, default: 500, minimum: 64, maximum: 4096 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(4096)
  thumbnailWidth?: number;

  @ApiProperty({ required: false, default: 400, minimum: 64, maximum: 4096 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(4096)
  thumbnailHeight?: number;

  @ApiProperty({ required: false, enum: ['auto', 'core', 'water-well'], default: 'auto' })
  @IsOptional()
  @IsIn(['auto', 'core', 'water-well'])
  parameterType?: 'auto' | 'core' | 'water-well';
}
