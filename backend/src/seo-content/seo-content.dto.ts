import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
export class PlanConfigDto {
  @IsString() @MaxLength(120) industry: string;
  @IsString() @MaxLength(120) brand: string;
  @IsString() @MaxLength(5000) instructions: string;
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords: string[];
  @IsString() @MaxLength(120) model: string;
  @IsInt() @Min(0) menuId: number;
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  feeds: string[];
  @IsInt() @Min(1) @Max(168) intervalHours: number;
  @IsInt() @Min(1) @Max(10) dailyLimit: number;
  @IsOptional() @IsBoolean() searchEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(24) dailyCollectLimit?: number;
  @IsOptional() @IsIn(['deepseek', 'brave']) searchProvider?:
    'deepseek' | 'brave';
  @IsOptional()
  @IsIn(['deepseek-v4-flash', 'deepseek-v4-pro'])
  researchModel?: string;
  @IsOptional() @IsInt() @Min(1000) @Max(8000) maxOutputTokens?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) dailySearchLimit?: number;
  @IsOptional() @IsString() @MaxLength(12000) knowledge?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];
}
export class SavePlanDto {
  @IsInt() @Min(0) revision: number;
  @IsDefined()
  @ValidateNested()
  @Type(() => PlanConfigDto)
  config: PlanConfigDto;
}
export class SwitchDto {
  @IsBoolean() enabled: boolean;
}
export class SourceDto {
  @IsString() @MaxLength(200) title: string;
  @IsString() @MaxLength(1000) url: string;
  @IsString() @MaxLength(12000) notes: string;
  @IsBoolean() verified: boolean;
}
export class QueueDto {
  @IsIn(['collect', 'generate']) kind: string;
  @IsOptional() @IsInt() @Min(1) sourceId?: number;
  @IsOptional() @IsInt() @Min(1) newsId?: number;
}
export class ArticleDto {
  @IsString() @MaxLength(120) title: string;
  @IsString() @MaxLength(200) subtitle: string;
  @IsString() @MaxLength(250) keywords: string;
  @IsString() @MaxLength(1000) summary: string;
  @IsString() @MaxLength(60000) content: string;
}
export class SaveDraftDto {
  @IsInt() @Min(0) revision: number;
  @IsDefined() @ValidateNested() @Type(() => ArticleDto) draft: ArticleDto;
}
export class ScheduleDto {
  @IsInt() @Min(0) revision: number;
  @IsString() @MaxLength(40) scheduledAt: string;
}
export class LeaseDto {
  @IsString() @MaxLength(80) leaseToken: string;
}
export class CollectedSourceDto {
  @IsString() @MaxLength(200) title: string;
  @IsString() @MaxLength(1000) url: string;
  @IsString() @MaxLength(60) publishedAt: string;
  @IsOptional() @IsString() @MaxLength(12000) notes?: string;
}
export class CompleteJobDto extends LeaseDto {
  @IsOptional() @ValidateNested() @Type(() => ArticleDto) draft?: ArticleDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CollectedSourceDto)
  sources?: CollectedSourceDto[];
  @IsOptional() @IsInt() @Min(0) @Max(1000000) tokens?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  warnings?: string[];
}
export class FailJobDto extends LeaseDto {
  @IsString() @MaxLength(300) error: string;
}
