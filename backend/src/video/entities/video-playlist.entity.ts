import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
@Index(['siteId', 'playlistId'], { unique: true })
export class VideoPlaylist {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 0, comment: 'Managed site id' })
  siteId: number;

  @Column({ length: 64, comment: 'YouTube playlist id (PLxxx)' })
  playlistId: string;

  @Column({ length: 180, default: '', comment: 'Playlist title' })
  title: string;

  @Column({ default: '', comment: 'Playlist thumbnail URL' })
  thumbUrl: string;

  @Column({ default: 0, comment: 'Video count in playlist' })
  itemCount: number;

  @Column({ default: true, comment: 'Publish to website' })
  show: boolean;

  @Column({ default: 0, comment: 'Sort order' })
  orderNum: number;

  @Column({ default: '', comment: 'PbootCMS sort code after publish' })
  pbootScode: string;

  @CreateDateColumn({ comment: 'Created time' })
  createTime: Date;

  @UpdateDateColumn({ comment: 'Updated time' })
  updateTime: Date;
}
