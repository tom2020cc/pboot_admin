import { defineStore } from "pinia";
import { ref } from "vue";

export const useMyTokenStore = defineStore('myTokenBox',()=>{
    // 从本地浏览器缓存中获取toekn 如果没有就取空值
    const token = ref(localStorage.getItem('localToken')||"")
    function  saveToken(data:string){ 
        token.value = data
        console.log('token存储到store完成')
        localStorage.setItem('localToken',token.value)
        console.log('token存储到浏览器本地缓存中')
    }
    return {token,saveToken  }
})