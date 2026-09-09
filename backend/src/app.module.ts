import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MenuModule } from './menu/menu.module';
import { ImgUploadModule } from './img-upload/img-upload.module';
import { NewsModule } from './news/news.module';
import { ProductModule } from './product/product.module';
import { PageModule } from './page/page.module';
import { VideoModule } from './video/video.module';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SyncGuardModule } from './common/sync-guard.module';
import { DatabaseBackupModule } from './database-backup/database-backup.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { QuotationModule } from './quotation/quotation.module';
import { BrochureModule } from './brochure/brochure.module';
import { SiteRequestContextMiddleware } from './sites/site-request-context.service';
import { SitesModule } from './sites/sites.module';
import { SeoContentModule } from './seo-content/seo-content.module';

const entities = [__dirname + '/**/*.entity{.ts,.js}'];

const createDatabaseConfig = (config: ConfigService): TypeOrmModuleOptions =>
  config.get('DB_TYPE', 'sqljs') === 'postgres'
    ? {
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_DATABASE'),
        entities,
        synchronize: true,
      }
    : {
        type: 'sqljs',
        location: config.get('DB_SQLJS_LOCATION', 'dev.sqlite'),
        autoSave: true,
        entities,
        synchronize: true,
      };

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // 加载 .env 文件配置
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createDatabaseConfig,
    }),
    SitesModule,
    SyncGuardModule,
    UserModule,
    AuthModule,
    MenuModule,
    ImgUploadModule,
    NewsModule,
    ProductModule,
    PageModule,
    VideoModule,
    DatabaseBackupModule,
    QuotationModule,
    BrochureModule,
    SeoContentModule,
    
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局开启 JWT 守卫：除 @Public() 标记的接口（登录/注册）外，其余接口均需携带有效 Token
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SiteRequestContextMiddleware).forRoutes('*');
  }
}
