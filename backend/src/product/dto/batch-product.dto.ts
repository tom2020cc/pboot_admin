import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const PRODUCT_BATCH_ACTIONS = [
  'show',
  'top',
  'recommend',
  'sort',
  'move',
  'copy',
  'delete',
  'sync',
] as const;
export type ProductBatchAction = (typeof PRODUCT_BATCH_ACTIONS)[number];

export class ProductSortDto {
  @IsInt() @Min(1) id: number;
  @IsInt() @Min(0) @Max(999999) orderNum: number;
}

export class BatchProductDto {
  @IsIn(PRODUCT_BATCH_ACTIONS) action: ProductBatchAction;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];
  @IsOptional() @IsBoolean() value?: boolean;
  @IsOptional() @IsInt() @Min(1) menuId?: number;
  @IsOptional() @IsString() lang?: string;
  @IsOptional() @IsBoolean() allLanguages?: boolean;
  @IsOptional() @IsBoolean() deletePboot?: boolean;
  @IsOptional() @IsBoolean() confirmed?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductSortDto)
  orders?: ProductSortDto[];
}
