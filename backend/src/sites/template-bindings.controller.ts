import { Body, Controller, Get, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { TemplateBindingsService } from './template-bindings.service';

export class TemplateBindingRowDto {
  @IsString() @MaxLength(100) id: string;
  @IsOptional() @IsInt() @Min(1) cnMenuId?: number | null;
  @IsOptional() @IsInt() @Min(1) enMenuId?: number | null;
}
export class SaveTemplateBindingsDto {
  @IsString() @MaxLength(64) revision: string;
  @IsString() @MaxLength(64) templateVersion: string;
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => TemplateBindingRowDto) bindings: TemplateBindingRowDto[];
}
export class ApplyTemplateBindingsDto { @IsUUID() previewId: string; }

@Controller('sites/current/template-bindings')
export class TemplateBindingsController {
  constructor(private readonly bindings: TemplateBindingsService) {}
  @Get() list() { return this.bindings.list(); }
  @Post('save') save(@Body() dto: SaveTemplateBindingsDto) { return this.bindings.save(dto); }
  @Post('preview') preview(@Body() dto: SaveTemplateBindingsDto) { return this.bindings.preview(dto); }
  @Post('apply') apply(@Body() dto: ApplyTemplateBindingsDto) { return this.bindings.apply(dto.previewId); }
}
