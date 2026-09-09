import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
@Index(['siteId', 'menuId'])
export class Page {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 0, comment: 'Managed site id' })
  siteId: number;

  @Column()
  menuId: number;

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

  @Column({ default: true })
  show: boolean;

  @Column({ default: 0 })
  orderNum: number;

  @CreateDateColumn()
  createTime: Date;

  @UpdateDateColumn()
  updateTime: Date;
}
