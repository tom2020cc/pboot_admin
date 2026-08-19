import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from './entities/news.entity';
import { NewsTranslation } from './entities/news-translation.entity';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { Menu } from '../menu/entities/menu.entity';

@Module({
  imports: [TypeOrmModule.forFeature([News, NewsTranslation, Menu])],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
