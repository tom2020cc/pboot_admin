import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

@Module({
  imports:[TypeOrmModule.forFeature([User])],// 注册 User 实体
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService]//导出才能给别的模块或者服务里使用
})
export class UserModule {}
