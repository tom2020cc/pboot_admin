import { IsOptional, IsString } from 'class-validator';

export class TranslateMenuDto {
  @IsString()
  @IsOptional()
  model?: string;
}
