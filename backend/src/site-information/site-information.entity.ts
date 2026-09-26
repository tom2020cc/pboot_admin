import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { InformationData } from './site-information.fields';

@Entity('site_information_draft')
@Index(['siteId', 'language'], { unique: true })
export class SiteInformationDraft {
  @PrimaryGeneratedColumn() id: number;
  @Column() siteId: number;
  @Column() language: string;
  @Column({ type: 'simple-json' }) data: InformationData;
  @Column() revision: string;
  @Column() baseRevision: string;
  @Column({ default: '' }) sourceHash: string;
  @Column({ default: '' }) translatedModel: string;
  @Column({ default: '' }) translatedAt: string;
}
