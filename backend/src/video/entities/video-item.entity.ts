import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
@Index(['playlistId', 'videoId'], { unique: true })
export class VideoItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64, comment: 'Owning VideoPlaylist.playlistId (PLxxx)' })
  playlistId: string;

  @Column({ length: 32, comment: 'YouTube video id' })
  videoId: string;

  @Column({ length: 180, default: '', comment: 'Video title (English from YouTube)' })
  title: string;

  @Column({ default: '', comment: 'Cover thumbnail URL' })
  coverUrl: string;

  @Column({ default: 0, comment: 'Position inside playlist' })
  position: number;

  @Column({ default: true, comment: 'Publish to website' })
  show: boolean;

  @Column({ default: '', comment: 'PublishedAt from YouTube (added to playlist)' })
  publishedAt: string;

  @CreateDateColumn({ comment: 'Created time' })
  createTime: Date;

  @UpdateDateColumn({ comment: 'Updated time' })
  updateTime: Date;
}
