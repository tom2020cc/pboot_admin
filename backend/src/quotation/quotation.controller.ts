import { BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationService } from './quotation.service';
import { QuotationPdfService, MAX_QUOTATION_HTML_BYTES } from './quotation-pdf.service';
import { ExportQuotationPdfDto } from './dto/export-quotation-pdf.dto';

@Controller('quotations')
@ApiTags('报价单管理')
export class QuotationController {
  constructor(private readonly quotationService: QuotationService, private readonly pdf: QuotationPdfService) {}

  @Post('export-pdf')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('document', { limits: { fileSize: MAX_QUOTATION_HTML_BYTES, files: 1, fields: 2 } }))
  async exportPdf(@Body() paper: ExportQuotationPdfDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请提交报价单文档');
    return new StreamableFile(await this.pdf.render(file.buffer.toString('utf8'), paper.widthMm, paper.heightMm), {
      type: 'application/pdf', disposition: 'attachment; filename="quotation.pdf"',
    });
  }

  @Post()
  @ApiOperation({ summary: '保存新报价单' })
  create(@Body() body: CreateQuotationDto) {
    return this.quotationService.create(body);
  }

  @Get()
  @ApiOperation({ summary: '查询报价单列表' })
  @ApiQuery({ name: 'search', required: false })
  findAll(@Query('search') search?: string) {
    return this.quotationService.findAll(search);
  }

  @Get('next-number')
  @ApiOperation({ summary: '获取下一个报价单编号' })
  nextNumber(@Query('date') date?: string) {
    return this.quotationService.nextNumber(date);
  }

  @Get(':id')
  @ApiOperation({ summary: '查看报价单' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.quotationService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改报价单' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateQuotationDto) {
    return this.quotationService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除报价单' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.quotationService.remove(id);
  }
}
