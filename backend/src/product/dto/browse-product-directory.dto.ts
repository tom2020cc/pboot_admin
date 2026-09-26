import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class BrowseProductDirectoryDto {
  @ApiProperty({ description: '明确选择的网站 ID，不回退到其他网站' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  siteId: number;

  @ApiProperty({ required: false, description: '服务器目录，省略时读取当前网站根目录' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  directory?: string;
}
