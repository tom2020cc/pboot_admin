import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SyncNewsDto {
  @ApiProperty({ description: 'Language code to sync, for example en, zh-CN, es', required: false })
  @IsString()
  @IsOptional()
  lang?: string;

  @ApiProperty({ description: 'Sync all saved language versions', required: false, default: false })
  @IsBoolean()
  @IsOptional()
  all?: boolean;
}
