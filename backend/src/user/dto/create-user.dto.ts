import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class CreateUserDto {
    @ApiProperty({ description: '邮箱', example: 'tom@qq.com' })
    @IsEmail()
    email: string;
    @ApiProperty({ description: '密码', example: 'tom1993' })
    @IsString()
    @IsNotEmpty({ message: '密码不能为空' })
    password: string
}
