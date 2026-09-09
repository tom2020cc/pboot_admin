import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SitesService } from '../sites/sites.service';
import { Brochure } from './brochure.entity';
import { SaveBrochureDto } from './brochure.dto';

@Injectable()
export class BrochureService {
  constructor(@InjectRepository(Brochure) private readonly repo: Repository<Brochure>, private readonly sites: SitesService) {}

  private payload(body: SaveBrochureDto) {
    if (Buffer.byteLength(JSON.stringify(body.data), 'utf8') > 2 * 1024 * 1024) {
      throw new BadRequestException('产品介绍数据超过 2MB，请减少内容');
    }
    return { title: body.data.title.trim(), itemCount: body.data.items.length, data: body.data };
  }

  findAll(search = '') {
    const query = this.repo.createQueryBuilder('brochure')
      .select(['brochure.id', 'brochure.title', 'brochure.itemCount', 'brochure.createTime', 'brochure.updateTime'])
      .where('brochure.siteId = :siteId', { siteId: this.sites.getCurrentSiteId() })
      .orderBy('brochure.updateTime', 'DESC').addOrderBy('brochure.id', 'DESC');
    if (search.trim()) query.andWhere('brochure.title LIKE :search', { search: `%${search.trim().slice(0, 200)}%` });
    return query.getMany();
  }

  async findOne(id: number) {
    const row = await this.repo.findOneBy({ id, siteId: this.sites.getCurrentSiteId() });
    if (!row) throw new NotFoundException('产品介绍不存在或不属于当前站点');
    return row;
  }

  create(body: SaveBrochureDto) {
    return this.repo.save(this.repo.create({ ...this.payload(body), siteId: this.sites.getCurrentSiteId() }));
  }

  async update(id: number, body: SaveBrochureDto) {
    const row = await this.findOne(id);
    return this.repo.save(Object.assign(row, this.payload(body)));
  }

  async remove(id: number) {
    const row = await this.findOne(id);
    await this.repo.remove(row);
    return { id, msg: '产品介绍已删除' };
  }
}
