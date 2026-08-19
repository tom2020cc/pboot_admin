import request from '@/utils/request'

export type LoginInfo = {
    email:string,
    password:string
}

export type UserInfo = {
    id: number,
    email: string,
    password?: string,
    createTime?: string,
    updateTime?: string,
}

export const login =async (loginInfo:LoginInfo)=>{
    return await request({
        method:'POST',
        url:'/auth/login',
        data:loginInfo
    })
}
export const signup = async (userInfo: LoginInfo)=>{
    return await request({
        method:'POST',
        url:'/auth/signup',
        data:userInfo
    })
}
export const getInfo = async ()=>{
    return await request({
        method:'GET',
        url:'/auth/profile',
    })
}
export const getUsers = async ()=>{
    return await request<UserInfo[]>({
        method:'GET',
        url:'/user',
    })
}
export const createUser = async (userInfo: LoginInfo)=>{
    return await request<UserInfo>({
        method:'POST',
        url:'/user',
        data:userInfo,
    })
}
export const getUserById = async (id: number | string)=>{
    return await request<UserInfo>({
        method:'GET',
        url:`/user/${id}`,
    })
}
export const updateUser = async (id: number | string, userInfo: Partial<LoginInfo>)=>{
    return await request<UserInfo>({
        method:'PATCH',
        url:`/user/${id}`,
        data:userInfo,
    })
}
export const removeUser = async (id: number | string)=>{
    return await request({
        method:'DELETE',
        url:`/user/${id}`,
    })
}
