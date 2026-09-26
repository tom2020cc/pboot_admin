import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsObject, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { InformationData } from './site-information.fields';

export class InformationRevisionDto {
  @IsString() @MaxLength(20) language: string;
  @IsString() @MaxLength(100) revision: string;
}
export class SaveInformationDto extends InformationRevisionDto {
  @IsObject() data: InformationData;
}
export class TranslateInformationDto extends InformationRevisionDto {
  @IsString() @MaxLength(100) sourceRevision: string;
  @IsString() @MaxLength(100) model: string;
}
export class SyncInformationDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30)
  @ValidateNested({ each: true }) @Type(() => InformationRevisionDto)
  items: InformationRevisionDto[];
}
export class SetupInformationDto {
  @IsString() @MaxLength(64) token: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30)
  @IsString({ each: true }) @MaxLength(20, { each: true })
  languages: string[];
}
export class RemoteInformationDto extends SyncInformationDto {
  @IsInt() @Min(1) siteId: number;
  @IsString() @MaxLength(64) targetRevision: string;
}
