import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { Quotation } from './entities/quotation.entity';

@Injectable()
export class QuotationService {
  constructor(@InjectRepository(Quotation) private readonly quotationRepo: Repository<Quotation>) {}

  async create(body: CreateQuotationDto) {
    const quotationNo = body.quotationNo.trim();
    if (await this.quotationRepo.findOneBy({ quotationNo })) {
      throw new BadRequestException(`报价单编号 ${quotationNo} 已存在`);
    }
    return this.quotationRepo.save(this.quotationRepo.create({ ...body, quotationNo }));
  }

  async findAll(search = '') {
    const query = this.quotationRepo.createQueryBuilder('quotation').orderBy('quotation.updateTime', 'DESC');
    const keyword = search.trim();
    if (keyword) {
      query.where(
        '(quotation.quotationNo LIKE :keyword OR quotation.customerCompany LIKE :keyword OR quotation.customerContact LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }
    return query.getMany();
  }

  async findOne(id: number) {
    const quotation = await this.quotationRepo.findOneBy({ id });
    if (!quotation) throw new NotFoundException('没有找到该报价单');
    return quotation;
  }

  async update(id: number, body: UpdateQuotationDto) {
    const quotation = await this.findOne(id);
    if (body.quotationNo) {
      const quotationNo = body.quotationNo.trim();
      const duplicate = await this.quotationRepo.findOneBy({ quotationNo });
      if (duplicate && duplicate.id !== id) throw new BadRequestException(`报价单编号 ${quotationNo} 已存在`);
      body.quotationNo = quotationNo;
    }
    return this.quotationRepo.save(Object.assign(quotation, body));
  }

  async remove(id: number) {
    const quotation = await this.findOne(id);
    await this.quotationRepo.remove(quotation);
    return { msg: '报价单已删除', id };
  }

  async nextNumber(dateValue = '') {
    const compactDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      ? dateValue.replace(/-/g, '')
      : new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `BJ-${compactDate}-`;
    const rows = await this.quotationRepo
      .createQueryBuilder('quotation')
      .select('quotation.quotationNo', 'quotationNo')
      .where('quotation.quotationNo LIKE :prefix', { prefix: `${prefix}%` })
      .getRawMany<{ quotationNo: string }>();
    const largest = rows.reduce((max, row) => {
      const suffix = Number(String(row.quotationNo || '').slice(prefix.length));
      return Number.isInteger(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    return { quotationNo: `${prefix}${String(largest + 1).padStart(2, '0')}` };
  }
}
