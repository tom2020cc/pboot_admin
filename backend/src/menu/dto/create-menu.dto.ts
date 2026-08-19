import { ApiProperty } from "@nestjs/swagger";
import {  IsArray, IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateMenuDto {

    @ApiProperty({description:'栏目名称',example:'用户管理'})
    @IsString()
    name:string;

    @ApiProperty({description:'父级菜单ID',example:0,default:0})
    @IsNumber()
    parentId:number;

    @ApiProperty({description:'创建人',example:'Jack'})
    @IsString()
    publisher:string;

    @ApiProperty({description:'路径',example:'/abc'})
    @IsString()
    href:string;

    @ApiProperty({description:'编码',example:'100',required:false})
    @IsString()
    @IsOptional()
    code:string;

    @ApiProperty({description:'URL名称',example:'aboutUs',required:false})
    @IsString()
    @IsOptional()
    urlName:string;

    @ApiProperty({description:'模型',example:'专题',required:false})
    @IsString()
    @IsOptional()
    model:string;

    @ApiProperty({description:'列表页模板',example:'about.html',required:false})
    @IsString()
    @IsOptional()
    listTemplate:string;

    @ApiProperty({description:'详情页模板',example:'about.html',required:false})
    @IsString()
    @IsOptional()
    detailTemplate:string;

    @ApiProperty({description:'图标地址',example:['aa','bb','cc']})
    @IsArray()
    icon:string[];

    @ApiProperty({description:'排序',example:255,default:0})
    @IsNumber()
    orderNum:number;

    @ApiProperty({description:'是否显示',example:true})
    @IsBoolean()
    show:boolean;

}
