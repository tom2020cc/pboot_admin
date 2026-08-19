import { Entity, Column, PrimaryGeneratedColumn, BeforeInsert, BeforeUpdate, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import * as bcryptjs from "bcryptjs"
@Entity()
export class User {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({comment:'邮箱'})
    email: string;

    @Column({comment:'密码'})
    password: string;

    @CreateDateColumn({ comment: '创建时间' })
    createTime: Date;

    @UpdateDateColumn({ comment: '更新时间' })
    updateTime: Date;

    @BeforeInsert()  // 插入数据之前对密码进行加密处理
    @BeforeUpdate()
    async hashPassword() {
        if (this.password && !this.password.startsWith('$2')) {
            this.password = bcryptjs.hashSync(this.password, 10);
        }
    }

}
