import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsModule } from '../news/news.module';
import { SeoControl, SeoJob, SeoPlan, SeoSource } from './seo-content.entity';
import { SeoContentService } from './seo-content.service';
import { SeoContentController } from './seo-content.controller';
import { SeoWorkerController, SeoWorkerGuard } from './seo-worker.controller';
@Module({
  imports: [
    TypeOrmModule.forFeature([SeoControl, SeoJob, SeoPlan, SeoSource]),
    NewsModule,
  ],
  providers: [SeoContentService, SeoWorkerGuard],
  controllers: [SeoContentController, SeoWorkerController],
})
export class SeoContentModule {}
