import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('quotations')
export class Quotation {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ length: 80, comment: 'Quotation number' })
  quotationNo: string;

  @Column({ length: 200, default: '', comment: 'Customer company' })
  customerCompany: string;

  @Column({ length: 120, default: '', comment: 'Customer contact' })
  customerContact: string;

  @Column({ length: 20, default: 'USD', comment: 'Currency' })
  currency: string;

  @Column({ type: 'float', default: 0, comment: 'Quotation total' })
  total: number;

  @Column({ default: 0, comment: 'Product line count' })
  itemCount: number;

  @Column({ length: 20, default: '', comment: 'Quotation date' })
  quotationDate: string;

  @Column({ type: 'simple-json', comment: 'Complete quotation draft' })
  data: Record<string, unknown>;

  @CreateDateColumn({ comment: 'Created time' })
  createTime: Date;

  @UpdateDateColumn({ comment: 'Updated time' })
  updateTime: Date;
}
