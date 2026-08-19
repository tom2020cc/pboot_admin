import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

export class PbootScopeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  menuId: number;

  @IsIn(['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt'])
  lang: string;
}
