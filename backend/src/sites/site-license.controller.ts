import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SiteLicenseService } from './site-license.service';

export class SaveSiteLicenseDto {
  @IsInt() @Min(1) siteId: number;
  @IsIn(['phpstudy', 'baota']) environment: 'phpstudy' | 'baota';
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(500, { each: true }) domains: string[];
  @IsString() @MaxLength(16000) codes: string;
  @IsString() @MaxLength(50) phone: string;
  @IsString() @MaxLength(64) revision: string;
  @IsBoolean() apply: boolean;
  @IsOptional() @IsBoolean() syncRemote?: boolean;
}

@Controller('sites/current/system-license')
export class SiteLicenseController {
  constructor(private readonly licenses: SiteLicenseService) {}
  @Get() @Header('Cache-Control', 'no-store') read() { return this.licenses.read(); }
  @Post() @Header('Cache-Control', 'no-store') save(@Body() dto: SaveSiteLicenseDto) { return this.licenses.save(dto); }
}
