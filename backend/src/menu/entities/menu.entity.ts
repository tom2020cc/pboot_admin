import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Menu {
    @PrimaryGeneratedColumn()
    id: string;

    @Column({ length: 20, comment: '栏目名称' })
    name: string;
    @Column({ comment: '父级菜单ID' })
    parentId: number

    @Column({ comment: '创建人' })
    publisher: string;

    @Column({ comment: '路径' })
    href: string;

    @Column({ default: '', comment: '编码' })
    code: string;

    @Column({ default: '', comment: 'URL名称' })
    urlName: string;

    @Column({ default: '专题', comment: '模型' })
    model: string;

    @Column({ default: '', comment: '列表页模板' })
    listTemplate: string;

    @Column({ default: '', comment: '详情页模板' })
    detailTemplate: string;
    
    @Column('simple-array', { default: '', comment: '图标地址' })
    icon: string[];

    @Column({ comment: '是否显示' })
    show: boolean;

    @Column({ comment: '排序' })
    orderNum: number;

    @CreateDateColumn({ comment: '创建时间' })
    createTime: Date;

    @UpdateDateColumn({ comment: '更新时间' })
    updateTime: Date;
}
