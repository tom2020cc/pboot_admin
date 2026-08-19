<template>
  <div class="about">
    <h2>{{countState.count}}</h2>
    <hr/>
    <h2>2倍的数字：{{ countState.doubleCount}}</h2>
    <hr/>
    <button @click="incrementFun">相加</button>
  </div>
</template>
<script setup>
import {useCounterStore} from '@/stores/counter'
const countState = useCounterStore()

const  incrementFun =()=>{
  countState.increment()
}
</script>

<style>
@media (min-width: 1024px) {
  /* .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  } */
}
</style>
