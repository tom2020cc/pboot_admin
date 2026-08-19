import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Menu } from '../menu/entities/menu.entity';
import { NewsModule } from '../news/news.module';
import { PageTranslation } from './entities/page-translation.entity';
import { Page } from './entities/page.entity';
import { PageController } from './page.controller';
import { PageService } from './page.service';

@Module({
  imports: [ConfigModule, NewsModule, TypeOrmModule.forFeature([Page, PageTranslation, Menu])],
  controllers: [PageController],
  providers: [PageService],
})
export class PageModule {}
