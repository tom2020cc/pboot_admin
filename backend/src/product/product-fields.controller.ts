import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductFieldsService } from './product-fields.service';
import { SaveProductFieldDto } from './dto/product-field.dto';

@ApiTags('产品字段管理')
@Controller('product-fields')
export class ProductFieldsController {
  constructor(private readonly fields: ProductFieldsService) {}
  @Get() list() { return this.fields.list(); }
  @Post() create(@Body() dto: SaveProductFieldDto) { return this.fields.create(dto); }
  @Post('import') importFromPboot() { return this.fields.importFromPboot(); }
  @Post('sync') syncToPboot() { return this.fields.syncToPboot(); }
  @Patch(':name') update(@Param('name') name: string, @Body() dto: SaveProductFieldDto) { return this.fields.update(name, dto); }
  @Delete(':name') remove(@Param('name') name: string) { return this.fields.remove(name); }
}
