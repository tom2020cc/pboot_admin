import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class VideoPlaylist {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 64, comment: 'YouTube playlist id (PLxxx)' })
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
