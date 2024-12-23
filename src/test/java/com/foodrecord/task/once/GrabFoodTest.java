//package com.foodrecord.task.once;
//
//import cn.hutool.http.HttpRequest;
//import org.junit.jupiter.api.Test;
//import org.springframework.boot.test.context.SpringBootTest;
//
//@SpringBootTest
//public class GrabFoodTest {
//
//    @Test
//    public void executeTask() {
//        // 1. 发送GET请求获取数据
//        String url = "https://food.boohee.com//fb/v2/foods/fd0986af/detail?token=oruhmBQShLHzGNZ4qufnPHuuqPwuEAMY";
//        String result = HttpRequest.get(url).execute().body();
//        System.out.println(result);
//    }
//}
