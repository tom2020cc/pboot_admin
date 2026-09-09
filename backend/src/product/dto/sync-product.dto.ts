import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SyncProductDto {
  @ApiProperty({ description: 'Language code to sync, for example en, zh-CN, es', required: false })
  @IsString()
  @IsOptional()
  lang?: string;

  @ApiProperty({ description: 'Sync all saved language versions by default; false explicitly selects one language', required: false, default: true })
  @IsBoolean()
  @IsOptional()
  all?: boolean;
}
