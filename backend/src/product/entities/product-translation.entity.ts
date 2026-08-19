import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Product } from './product.entity';

@Entity('product_translations')
@Index(['productId', 'lang'], { unique: true })
export class ProductTranslation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  productId: number;

  @Column({ length: 16 })
  lang: string;

  @Column({ length: 180, default: '' })
  title: string;

  @Column({ default: '' })
  urlName: string;

  @Column({ default: '' })
  subtitle: string;

  @Column({ default: '' })
  keywords: string;

  @Column({ default: '' })
  description: string;

  @Column({ default: '' })
  summary: string;

  @Column('text', { default: '' })
  content: string;

  @Column('simple-array', { default: '' })
  carouselTitles: string[];

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  product: Product;

  @CreateDateColumn()
  createTime: Date;

  @UpdateDateColumn()
  updateTime: Date;
}
