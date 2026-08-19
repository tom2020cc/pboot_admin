import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Page } from './page.entity';

@Entity('page_translations')
@Index(['pageId', 'lang'], { unique: true })
export class PageTranslation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  pageId: number;

  @Column({ length: 16 })
  lang: string;

  @Column({ length: 160, default: '' })
  title: string;

  @Column({ default: '' })
  urlName: string;

  @Column({ default: '' })
  subtitle: string;

  @Column({ default: '' })
  keywords: string;

  @Column({ default: '' })
  description: string;

  @Column('text', { default: '' })
  content: string;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  page: Page;

  @CreateDateColumn()
  createTime: Date;

  @UpdateDateColumn()
  updateTime: Date;
}
