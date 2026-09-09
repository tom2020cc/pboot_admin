import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Param,
  Post,
  Res,
  UseFilters,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { ImgUploadService } from './img-upload.service';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import { Response } from 'express';
import { SitesService } from '../sites/sites.service';
import { Public } from '../auth/public.decorator';

// 单张图片大小上限：5MB（与前端 MAX_IMAGE_UPLOAD_SIZE 保持一致）
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_SIZE_TEXT = '5MB';

const uploadOptions = {
  storage: memoryStorage(),
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
  constructor(
    private readonly imgUploadService: ImgUploadService,
    private readonly sitesService: SitesService,
  ) {}

  @Get('file/:filename')
  @Public()
  serveFile(@Param('filename') filename: string, @Res() response: Response) {
    const cleanName = this.cleanFilename(filename);
    if (!/\.(?:jpe?g|png|gif|webp|avif|bmp|ico|svg|tiff?|jfif|heic|heif)$/i.test(cleanName)) {
      throw new BadRequestException('只能读取图片文件');
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const siteFile = join(this.getUploadDirectory(), cleanName);
    if (fs.existsSync(siteFile) && fs.statSync(siteFile).isFile()) return response.sendFile(siteFile);

    const legacyFile = join(process.cwd(), 'uploads', cleanName);
    if (this.sitesService.isDefaultSite(this.sitesService.getCurrentSiteId()) && fs.existsSync(legacyFile)) {
      return response.sendFile(legacyFile);
    }
    throw new BadRequestException('图片不存在');
  }

  @Post('img') //单文件上传 字段为aaa
  @UseInterceptors(FileInterceptor('aaa', uploadOptions))
  uploadFile(@UploadedFile() f: Express.Multer.File) {
    if (!f) throw new BadRequestException('请选择图片');
    return this.saveFile(f);
  }
  @Post('imgs') //多文件上传 字段为imgArr
  @UseInterceptors(FilesInterceptor('imgArr', 3, uploadOptions))
  uploadFiles(@UploadedFiles() files: Array<Express.Multer.File>) {
    if (!files?.length) throw new BadRequestException('请选择图片');
    // 多文件上传，最多上传 3 个文件
    const imgArr = files.map((item) => this.saveFile(item));
    return imgArr;
  }

  private saveFile(file: Express.Multer.File) {
    const extension = extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const filename = `${randomBytes(10).toString('hex')}${extension}`;
    fs.writeFileSync(join(this.getUploadDirectory(), filename), file.buffer);
    return filename;
  }

  private getUploadDirectory() {
    const directory = join(this.sitesService.getCurrentSiteStorageDir('api'), 'uploads');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  private cleanFilename(filename: string) {
    const decoded = String(filename || '');
    if (!decoded || /[\\/:\x00-\x1f]/.test(decoded) || decoded === '.' || decoded === '..') {
      throw new BadRequestException('图片文件名无效');
    }
    return decoded;
  }
}
