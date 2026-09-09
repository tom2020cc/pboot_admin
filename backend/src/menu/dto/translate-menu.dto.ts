import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { MENU_TRANSLATION_LANGUAGES } from '../menu-translation-quality';

export class TranslateMenuDto {
  @IsString()
  @IsOptional()
  model?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsIn(Object.keys(MENU_TRANSLATION_LANGUAGES), { each: true })
  targetAcodes?: string[];
}
