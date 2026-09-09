import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
@Index(['siteId', 'menuId'])
export class News {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 0, comment: 'Managed site id' })
  siteId: number;

  @Column({ comment: 'Menu ID' })
  menuId: number;

  @Column({ length: 120, comment: 'Title' })
  title: string;

  @Column({ default: '', comment: 'URL name' })
  urlName: string;

  @Column({ default: '', comment: 'Subtitle' })
  subtitle: string;

  @Column({ default: '', comment: 'SEO keywords' })
  keywords: string;

  @Column({ default: '', comment: 'SEO description' })
  description: string;

  @Column({ default: '', comment: 'Thumbnail' })
  thumbnail: string;

  @Column({ default: '', comment: 'Summary' })
  summary: string;

  @Column('text', { default: '', comment: 'HTML content' })
  content: string;

  @Column({ default: 'admin', comment: 'Author' })
  author: string;

  @Column({ default: '', comment: 'Source' })
  source: string;

  @Column({ default: true, comment: 'Visible status' })
  show: boolean;

  @Column({ default: 0, comment: 'Sort order' })
  orderNum: number;

  @CreateDateColumn({ comment: 'Created time' })
  createTime: Date;

  @UpdateDateColumn({ comment: 'Updated time' })
  updateTime: Date;
}
