import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Controller()
@ApiTags('首页管理')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiBearerAuth() // 设置需要携带 Token
  @UseGuards(JwtAuthGuard) //设置守卫拦截 需要jwt认证通过才可以访问
  
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('public')
  getHi(): string { return '我是公共页面 不用jwt也可以访问'}
}

