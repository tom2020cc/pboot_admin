import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { UpdatePlaylistDto, UpdateVideoItemDto } from './dto/video.dto';
import { VideoService } from './video.service';

@Controller('videos')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Get()
  findAll() {
    return this.videoService.findAll();
  }

  @Get('stats')
  findStats() {
    return this.videoService.getStats();
  }

  @Get('items')
  findItems(@Query('playlistId') playlistId?: string) {
    return this.videoService.findItems(playlistId);
  }

  @Post('youtube-sync')
  syncFromYoutube() {
    return this.videoService.syncFromYoutube();
  }

  @Post('cleanup-pboot')
  cleanupPboot() {
    return this.videoService.cleanupPboot();
  }

  @Post('push-list')
  pushVideoList() {
    return this.videoService.pushVideoList();
  }

  @Patch('items/:id')
  updateItem(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateVideoItemDto) {
    return this.videoService.updateItem(id, body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdatePlaylistDto) {
    return this.videoService.update(id, body);
  }
}
