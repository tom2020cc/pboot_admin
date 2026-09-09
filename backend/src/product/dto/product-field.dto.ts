import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class SaveProductFieldDto {
  @IsOptional() @IsString() @Matches(/^ext_[a-zA-Z][a-zA-Z0-9_]{0,55}$/)
  name?: string;

  @IsString() @MaxLength(60)
  label: string;

  @IsOptional() @IsString() @MaxLength(20)
  unit?: string;

  @IsOptional() @IsInt() @Min(0) @Max(9999)
  sort?: number;

  @IsOptional() @IsBoolean()
  enabled?: boolean;
}
