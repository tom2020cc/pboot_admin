import { ManagedSiteEnvironment } from '../entities/managed-site.entity';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveManagedSiteDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(80)
  code: string;

  @IsOptional()
  @IsIn(['phpstudy', 'baota', 'remote'])
  environment?: ManagedSiteEnvironment;

  @IsString()
  @MaxLength(1000)
  rootPath: string;

  @IsString()
  @MaxLength(1000)
  dbPath: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  publicBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  youtubeChannelId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateManagedSiteDto extends SaveManagedSiteDto {}

export class DiscoverManagedSitesDto {
  @IsString()
  @MaxLength(1000)
  parentPath: string;

  @IsOptional()
  @IsIn(['phpstudy', 'baota', 'remote'])
  environment?: ManagedSiteEnvironment;
}

export class SaveSharedSiteSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  youtubeApiKey?: string;
}
