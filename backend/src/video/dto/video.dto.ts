import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class UpdatePlaylistDto {
  @ApiProperty({ description: 'Sort order', example: 10, required: false })
  @IsNumber()
  @IsOptional()
  orderNum?: number;

  @ApiProperty({ description: 'Publish to website', example: true, required: false })
  @IsBoolean()
  @IsOptional()
  show?: boolean;
}

export class UpdateVideoItemDto {
  @ApiProperty({ description: 'Position inside playlist', example: 1, required: false })
  @IsNumber()
  @IsOptional()
  position?: number;

  @ApiProperty({ description: 'Publish to website', example: true, required: false })
  @IsBoolean()
  @IsOptional()
  show?: boolean;
}
