import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ManagedSiteEnvironment = 'phpstudy' | 'baota' | 'remote';

@Entity('managed_sites')
export class ManagedSite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 120 })
  name: string;

  @Index({ unique: true })
  @Column({ length: 80 })
  code: string;

  @Column({ length: 20, default: 'phpstudy' })
  environment: ManagedSiteEnvironment;

  @Column({ length: 1000 })
  rootPath: string;

  @Column({ length: 1000 })
  dbPath: string;

  @Column({ length: 500, default: '' })
  publicBaseUrl: string;

  @Column({ length: 120, default: '' })
  youtubeChannelId: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: false })
  isDefault: boolean;

  @Column({ type: 'text', default: '' })
  notes: string;

  @CreateDateColumn()
  createTime: Date;

  @UpdateDateColumn()
  updateTime: Date;
}
