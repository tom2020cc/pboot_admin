import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { News } from './news.entity';

@Entity('news_translations')
@Index(['newsId', 'lang'], { unique: true })
export class NewsTranslation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  newsId: number;

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

  @Column({ default: '' })
  summary: string;

  @Column('text', { default: '' })
  content: string;

  @ManyToOne(() => News, { onDelete: 'CASCADE' })
  news: News;

  @CreateDateColumn()
  createTime: Date;

  @UpdateDateColumn()
  updateTime: Date;
}
