import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class SyncNewsScopeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  menuId: number;
}
