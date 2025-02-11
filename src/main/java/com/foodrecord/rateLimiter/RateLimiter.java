//package com.foodrecord.rateLimiter;
//
//import java.util.concurrent.Semaphore;
//
//public class RateLimiter {
//    private final Semaphore semaphore;
//
//    public RateLimiter(int maxRequests) {
//        this.semaphore = new Semaphore(maxRequests);
//    }
//
//    public boolean tryAcquire() {
//        return semaphore.tryAcquire();
//    }
//
//    public void release() {
//        semaphore.release();
//    }
//}