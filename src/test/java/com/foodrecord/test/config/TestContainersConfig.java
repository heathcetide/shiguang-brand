package com.foodrecord.test.config;//package com.foodrecord.test.config;
//
//import org.testcontainers.containers.MySQLContainer;
//import org.testcontainers.containers.RedisContainer;
//import lombok.extern.slf4j.Slf4j;
//
//@Slf4j
//public class TestContainersConfig {
//    private static final MySQLContainer<?> mysql =
//        new MySQLContainer<>("mysql:8.0")
//            .withDatabaseName("foodrecord_test")
//            .withUsername("test")
//            .withPassword("test");
//
//    private static final RedisContainer redis =
//        new RedisContainer("redis:6.2")
//            .withExposedPorts(6379);
//
//    public static void initializeContainers() {
//        mysql.start();
//        redis.start();
//
//        System.setProperty("spring.datasource.url", mysql.getJdbcUrl());
//        System.setProperty("spring.redis.host", redis.getHost());
//        System.setProperty("spring.redis.port",
//            String.valueOf(redis.getFirstMappedPort()));
//    }
//}