import { SetMetadata } from '@nestjs/common';

// 标记某个接口为公开（无需 JWT）。全局守卫会跳过带此标记的接口。
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
