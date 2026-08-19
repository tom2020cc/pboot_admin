import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto extends PartialType(CreateUserDto) {
    @ApiProperty({ description: '邮箱', example: 'tom@163.com', required: false })//不是必选的
    @IsEmail()
    @IsOptional()
    email: string;
    @ApiProperty({ description: '密码', example: 'to12345', required: false })
    @IsString()
    @IsOptional()
    password: string;
}
