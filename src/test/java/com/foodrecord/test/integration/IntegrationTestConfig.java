package com.foodrecord.test.integration;//package com.foodrecord.test.integration;
//
//import org.springframework.context.annotation.Configuration;
//import org.springframework.test.context.TestPropertySource;
//import lombok.extern.slf4j.Slf4j;
//
//@Slf4j
//@Configuration
//@TestPropertySource("classpath:integration-test.properties")
//public class IntegrationTestConfig {
//
//    @Bean
//    public TestContainerManager testContainerManager() {
//        return TestContainerManager.builder()
//            .mysqlContainer(createMySQLContainer())
//            .redisContainer(createRedisContainer())
//            .kafkaContainer(createKafkaContainer())
//            .build();
//    }
//
//    @Bean
//    public TestDataSourceConfig testDataSourceConfig(
//            TestContainerManager containerManager) {
//        return TestDataSourceConfig.builder()
//            .url(containerManager.getMysqlContainer().getJdbcUrl())
//            .username("test")
//            .password("test")
//            .maxPoolSize(10)
//            .build();
//    }
//
//    @Bean
//    public IntegrationTestHelper integrationTestHelper(
//            TestContainerManager containerManager,
//            TestDataSourceConfig dataSourceConfig) {
//        return new IntegrationTestHelper(containerManager, dataSourceConfig);
//    }
//
//    private MySQLContainer<?> createMySQLContainer() {
//        return new MySQLContainer<>("mysql:8.0")
//            .withDatabaseName("integration_test")
//            .withUsername("test")
//            .withPassword("test")
//            .withInitScript("sql/init.sql");
//    }
//}