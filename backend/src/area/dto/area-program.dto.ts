import { Type } from 'class-transformer';
import { IsBoolean, IsInt, Matches, Min } from 'class-validator';

export class AreaProgramSiteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  siteId: number;
}

export class RepairAreaProgramDto extends AreaProgramSiteDto {
  @Matches(/^[a-f0-9]{64}$/)
  revision: string;

  @IsBoolean()
  syncRemote: boolean;
}
