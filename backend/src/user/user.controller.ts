import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('user')
@ApiTags('用户管理')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @ApiOperation({summary:'新增用户',description:'添加一个用户信息'})
  @ApiBody({type:CreateUserDto,description:'输入邮箱和密码'})
  @Post()
  create(@Body() postBoj: CreateUserDto) {  return this.userService.create(postBoj) }
  
  @ApiOperation({summary:'获取用户列表',description:'展示用户列表'})
  @Get()
  findAll() { return this.userService.findAll()}

  @ApiOperation({summary:'获取一条用户信息',description:'根据id值获取用户信息'})
  @Get(':id')
  findOne(@Param('id',ParseIntPipe) id: number) {
    console.log(typeof(id))
    return this.userService.findOneById(id);
  }

  @ApiOperation({summary:'更新一条用户信息',description:'根据id值修改用户信息'})
  @Patch(':id')
  update(@Param('id',ParseIntPipe) id: number, @Body() PostObj: UpdateUserDto) {
    return this.userService.update(+id, PostObj);
  }

  @ApiOperation({summary:'删除一条用户',description:'根据id值删除一条用户数据'})
  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.userService.remove(id);
  }
}
