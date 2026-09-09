import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { SeoContentService } from './seo-content.service';
import { CompleteJobDto, FailJobDto, LeaseDto } from './seo-content.dto';
@Injectable()
export class SeoWorkerGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const expected = Buffer.from(
      String(this.config.get('SEO_WORKER_TOKEN') || ''),
    );
    const supplied = Buffer.from(
      String(
        context.switchToHttp().getRequest().headers['x-seo-worker-token'] || '',
      ),
    );
    if (
      expected.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new UnauthorizedException('任务进程认证失败');
    return true;
  }
}
@Public()
@UseGuards(SeoWorkerGuard)
@Controller('seo-worker')
export class SeoWorkerController {
  constructor(private readonly service: SeoContentService) {}
  @Post('claim') claim() {
    return this.service.claim();
  }
  @Post(':id/heartbeat') heartbeat(
    @Param('id') id: string,
    @Body() body: LeaseDto,
  ) {
    return this.service.heartbeat(id, body.leaseToken);
  }
  @Post(':id/complete') complete(
    @Param('id') id: string,
    @Body() body: CompleteJobDto,
  ) {
    return this.service.complete(id, body);
  }
  @Post(':id/fail') fail(@Param('id') id: string, @Body() body: FailJobDto) {
    return this.service.fail(id, body.leaseToken, body.error);
  }
  @Post(':id/publish') publish(
    @Param('id') id: string,
    @Body() body: LeaseDto,
  ) {
    return this.service.publish(id, body.leaseToken);
  }
}
