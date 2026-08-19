import { Body, Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { UserService } from 'src/user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

@ApiTags('登录管理')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService) { }
  @ApiOperation({ summary: '用户注册', description: '添加一个用户信息' })
  @Public()
  @Post('/signup')
  create(@Body() postobj: CreateUserDto) {
    return this.userService.create(postobj)
  }
  @ApiOperation({ summary: '用户登录', description: '用户登录获取token' })
  @Public()
  @Post('/login')
  login(@Body() postObj: CreateUserDto) {
    return this.authService.login(postObj)
  }
  @ApiOperation({ summary: '获取个人信息', description: '根据携带的token,获取当前登录用户的信息' })
  @Get('profile')
  @ApiBearerAuth()//设置需要携带Token
  // 添加认证守卫，确保请求携带有效的 Token 设置守卫拦截 需要jwt认证通过才可以访问
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req) {
    return req.user;
  }
}
