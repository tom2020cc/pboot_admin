import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  ExceptionFilter,
  Post,
  UseFilters,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { ImgUploadService } from './img-upload.service';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomBytes } from 'crypto';

// 单张图片大小上限：5MB（与前端 MAX_IMAGE_UPLOAD_SIZE 保持一致）
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_SIZE_TEXT = '5MB';

// 设置文件存储的配置
const storage = diskStorage({
  destination: './uploads',
  filename: (_req, file, callback) => {
    // 使用加密随机字节生成文件名，避免弱随机导致的重名碰撞
    const randomName = randomBytes(10).toString('hex');
    callback(null, `${randomName}${extname(file.originalname)}`);
  },
});

const uploadOptions = {
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, callback) => {
    if (!/^image\//i.test(file.mimetype || '')) {
      return callback(new BadRequestException('只能上传图片文件'), false);
    }
    return callback(null, true);
  },
};

// 把 multer 抛出的英文错误统一翻译为中文，保持提示一致
@Catch()
export class UploadI18nFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const anyExc = exception as { getStatus?: () => number; message?: string };
    const status = typeof anyExc?.getStatus === 'function' ? anyExc.getStatus() : 400;
    let message = anyExc?.message ? String(anyExc.message) : '上传失败';
    if (/File too large/i.test(message)) {
      message = `图片文件过大，已超过单张 ${MAX_IMAGE_SIZE_TEXT} 的限制，请压缩后再上传`;
    } else if (/Unexpected field/i.test(message)) {
      message = '上传字段或文件数量超出限制（单次最多 3 张图片）';
    }
    response.status(status).json({ statusCode: status, message, error: 'Bad Request' });
  }
}

@Controller('img-upload')
@UseFilters(UploadI18nFilter)
export class ImgUploadController {
  constructor(private readonly imgUploadService: ImgUploadService) {}
  @Post('img') //单文件上传 字段为aaa
  @UseInterceptors(FileInterceptor('aaa', uploadOptions))
  uploadFile(@UploadedFile() f: Express.Multer.File) {
    if (!f) throw new BadRequestException('请选择图片');
    return f?.filename;
  }
  @Post('imgs') //多文件上传 字段为imgArr
  @UseInterceptors(FilesInterceptor('imgArr', 3, uploadOptions))
  uploadFiles(@UploadedFiles() files: Array<Express.Multer.File>) {
    if (!files?.length) throw new BadRequestException('请选择图片');
    // 多文件上传，最多上传 3 个文件
    const imgArr = files.map((item) => item.filename);
    return imgArr;
  }
}
