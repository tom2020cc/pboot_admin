import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface PlanConfig {
  industry: string;
  brand: string;
  instructions: string;
  keywords: string[];
  model: string;
  menuId: number;
  feeds: string[];
  intervalHours: number;
  dailyLimit: number;
}
export const defaultPlan = (): PlanConfig => ({
  industry: '',
  brand: '',
  instructions: '',
  keywords: [],
  model: '',
  menuId: 0,
  feeds: [],
  intervalHours: 24,
  dailyLimit: 1,
});
@Entity('seo_content_plan')
export class SeoPlan {
  @PrimaryColumn() siteId: number;
  @Column({ default: false }) enabled: boolean;
  @Column({ default: 0 }) revision: number;
  @Column('simple-json') config: PlanConfig;
  @Column({ default: '' }) nextRunAt: string;
}
@Entity('seo_content_control')
export class SeoControl {
  @PrimaryColumn() id: number;
  @Column({ default: true }) paused: boolean;
  @Column({ default: '' }) heartbeat: string;
}
@Entity('seo_content_source')
@Index(['siteId', 'fingerprint'], { unique: true })
export class SeoSource {
  @PrimaryGeneratedColumn() id: number;
  @Column() siteId: number;
  @Column() fingerprint: string;
  @Column() title: string;
  @Column({ default: '' }) url: string;
  @Column({ default: '' }) publishedAt: string;
  @Column('text', { default: '' }) notes: string;
  @Column({ default: false }) verified: boolean;
  @CreateDateColumn() createdAt: Date;
}
export interface ArticleDraft {
  title: string;
  subtitle: string;
  keywords: string;
  summary: string;
  content: string;
}
export type JobState =
  | 'queued'
  | 'running'
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'paused'
  | 'uncertain'
  | 'done';
@Entity('seo_content_job')
@Index(['siteId', 'status'])
export class SeoJob {
  @PrimaryColumn() id: string;
  @Column() siteId: number;
  @Column() kind: string;
  @Column() status: JobState;
  @Column('simple-json') snapshot: PlanConfig & {
    source?: { id: number; title: string; url: string; notes: string };
    provider?: string;
  };
  @Column('simple-json', { nullable: true }) draft: ArticleDraft | null;
  @Column({ default: '' }) leaseToken: string;
  @Column({ default: '' }) leaseUntil: string;
  @Column({ default: 0 }) attempts: number;
  @Column({ default: 0 }) tokens: number;
  @Column({ default: 0 }) revision: number;
  @Column({ default: 0 }) newsId: number;
  @Column({ default: '' }) scheduledAt: string;
  @Column('text', { default: '' }) error: string;
  @CreateDateColumn() createdAt: Date;
}
