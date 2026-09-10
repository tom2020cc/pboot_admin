import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { UserService } from '../user/user.service';
import * as bcryptjs from "bcryptjs"
import { JwtPayload } from './jwt.payload';
@Injectable()
export class AuthService {
    constructor(
        private readonly userService: UserService,
        private readonly JwtService: JwtService) { }
    // 登录
    async login(postObj: CreateUserDto) {
        const findUser = await this.userService.findOneBy(postObj.email)
        if (!findUser) { throw new NotFoundException('该用户不存在') }// 没有找到该用户
        //找到了   然后对比密码
        const compareRes = bcryptjs.compareSync(postObj.password, findUser.password)
        if (!compareRes) { throw new BadRequestException('密码不正确') }// 密码不正确
        // 密码正确 派发token
        const payload: JwtPayload = { email: findUser.email, sub: findUser.id }
        return {
            access_token: this.JwtService.sign(payload),msg: '登录成功'
        }
    }
}
