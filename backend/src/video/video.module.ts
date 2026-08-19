import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Menu } from '../menu/entities/menu.entity';
import { VideoItem } from './entities/video-item.entity';
import { VideoPlaylist } from './entities/video-playlist.entity';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [TypeOrmModule.forFeature([VideoPlaylist, VideoItem, Menu]), ConfigModule],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
