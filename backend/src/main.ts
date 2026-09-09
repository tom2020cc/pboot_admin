import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';

  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));
  const pbootSiteRoot = process.env.PBOOT_SITE_ROOT || join(process.cwd(), '..', '..');
  app.use('/pboot-static', express.static(join(pbootSiteRoot, 'static')));
  app.enableCors();
  // 优雅关闭：Ctrl+C / 关闭窗口 / SIGTERM 时，先让 TypeORM 完成写盘再退出，
  // 避免 sqljs(autoSave) 写 dev.sqlite 中途被强杀导致文件损坏
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('后台管理 API')
    .setDescription('供后台管理界面调用的服务端 API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const port = Number(process.env.BACKEND_PORT || 5108);
  await app.listen(port);
  console.log(`http://localhost:${port}/api-docs`);
}

bootstrap();
