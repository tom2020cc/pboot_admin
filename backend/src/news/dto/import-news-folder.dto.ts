import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class ImportNewsFolderDto {
  @ApiProperty({ description: '包含多个新闻子文件夹的本地目录' })
  @IsString()
  sourceDirectory: string;

  @ApiProperty({ description: '目标中文新闻栏目 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  menuId: number;
}
