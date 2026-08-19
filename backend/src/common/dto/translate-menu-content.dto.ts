import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Min } from 'class-validator';

export class TranslateMenuContentDto {
  @ApiProperty({ description: '当前目标语言栏目 ID', example: 130 })
  @IsInt()
  @Min(1)
  menuId: number;

  @ApiProperty({ description: '目标语言', example: 'en' })
  @IsString()
  @IsIn(['en', 'es', 'fr', 'ru', 'ar', 'pt'])
  targetLang: string;

  @ApiProperty({ description: '翻译模型', example: 'glm-4.7-flash' })
  @IsString()
  model: string;
}
