import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BrochureDataDto } from './brochure.dto';

@Entity('product_brochures')
@Index(['siteId', 'updateTime'])
export class Brochure {
  @PrimaryGeneratedColumn() id: number;
  @Column() siteId: number;
  @Column() title: string;
  @Column() itemCount: number;
  @Column({ type: 'simple-json' }) data: BrochureDataDto;
  @CreateDateColumn() createTime: Date;
  @UpdateDateColumn() updateTime: Date;
}
