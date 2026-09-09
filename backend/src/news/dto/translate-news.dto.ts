import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class TranslateNewsDto {
  @ApiProperty({ description: '内容类型', example: 'news', required: false })
  @IsString()
  @IsOptional()
  @IsIn(['news', 'page'])
  contentType?: 'news' | 'page';

  @ApiProperty({ description: '源语言', example: 'zh-CN', required: false })
  @IsString()
  @IsOptional()
  sourceLang?: string;

  @ApiProperty({ description: '目标语言', example: 'en' })
  @IsString()
  @IsIn(['en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'])
  targetLang: string;

  @ApiProperty({ description: '翻译模型', example: 'gpt-4o-mini' })
  @IsString()
  model: string;

  @ApiProperty({ description: '源标题', example: '中文新闻标题' })
  @IsString()
  title: string;

  @ApiProperty({ description: '源副标题', required: false })
  @IsString()
  @IsOptional()
  subtitle?: string;

  @ApiProperty({ description: '源关键词', required: false })
  @IsString()
  @IsOptional()
  keywords?: string;

  @ApiProperty({ description: '源描述', required: false })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiProperty({ description: '源正文 HTML', required: false })
  @IsString()
  @IsOptional()
  content?: string;
}
