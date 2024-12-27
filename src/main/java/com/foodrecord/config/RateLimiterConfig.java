//package com.foodrecord.config;
//
//import com.google.common.util.concurrent.RateLimiter;
//import org.springframework.context.annotation.Bean;
//import org.springframework.context.annotation.Configuration;
//
//@Configuration
//public class RateLimiterConfig {
//
//    @Bean
//    public RateLimiter rateLimiter() {
//        // 每秒生成 10 个许可
//        return RateLimiter.create(30.0);
//    }
//
//    public RateLimiter getUserRateLimiter(String userLevel) {
//        switch (userLevel) {
//            case "VIP":
//                return RateLimiter.create(50.0); // VIP 用户限流高
//            case "REGULAR":
//                return RateLimiter.create(10.0); // 普通用户限流低
//            default:
//                return RateLimiter.create(5.0);  // 未知用户限流最低
//        }
//    }
//    RateLimiter apiLimiter = RateLimiter.create(10.0); // 接口限流 10 次/秒
//    RateLimiter dbLimiter = RateLimiter.create(5.0);   // 数据库操作限流 5 次/秒
//
//    public void processRequest() {
//        if (apiLimiter.tryAcquire()) {
//            System.out.println("API 请求通过");
//        }
//        if (dbLimiter.tryAcquire()) {
//            System.out.println("数据库操作通过");
//        }
//    }
//}