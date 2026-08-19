import { Module } from '@nestjs/common';
import { ImgUploadService } from './img-upload.service';
import { ImgUploadController } from './img-upload.controller';

@Module({
  controllers: [ImgUploadController],
  providers: [ImgUploadService],
})
export class ImgUploadModule {}
