import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ImportProductFolderDto {
  @ApiProperty({ description: '包含多个型号子文件夹的本地目录' })
  @IsString()
  sourceDirectory: string;

  @ApiProperty({ description: '目标中文产品栏目 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  menuId: number;

  @ApiProperty({ required: false, enum: ['auto', 'core', 'water-well'], default: 'auto' })
  @IsOptional()
  @IsIn(['auto', 'core', 'water-well'])
  parameterType?: 'auto' | 'core' | 'water-well';
}
