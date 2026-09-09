import { BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { SaveBrochureDto } from './brochure.dto';
import { BrochureService } from './brochure.service';
import { BrochurePdfService, MAX_BROCHURE_HTML_BYTES } from './brochure-pdf.service';

@ApiTags('产品介绍')
@Controller('brochures')
export class BrochureController {
  constructor(private readonly service: BrochureService, private readonly pdf: BrochurePdfService) {}
  @Post('export-pdf')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('document', { limits: { fileSize: MAX_BROCHURE_HTML_BYTES, files: 1, fields: 0 } }))
  async exportPdf(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请提交产品介绍文档');
    return new StreamableFile(await this.pdf.render(file.buffer.toString('utf8')), {
      type: 'application/pdf', disposition: 'attachment; filename="product-introduction.pdf"',
    });
  }
  @Get() findAll(@Query('search') search?: string) { return this.service.findAll(search); }
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() create(@Body() body: SaveBrochureDto) { return this.service.create(body); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() body: SaveBrochureDto) { return this.service.update(id, body); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
