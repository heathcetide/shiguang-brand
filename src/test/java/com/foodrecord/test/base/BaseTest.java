package com.foodrecord.test.base;//package com.foodrecord.test.base;
//
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.springframework.boot.test.context.SpringBootTest;
//import org.springframework.test.context.ActiveProfiles;
//import org.testcontainers.junit.jupiter.Testcontainers;
//import lombok.extern.slf4j.Slf4j;
//
//@Slf4j
//@SpringBootTest
//@ActiveProfiles("test")
//@Testcontainers
//@ExtendWith(MockitoExtension.class)
//public abstract class BaseTest {
//
//    @BeforeAll
//    static void setUp() {
//        TestContainersConfig.initializeContainers();
//    }
//
//    @BeforeEach
//    void setUpEach() {
//        TestDataPreparer.cleanTestData();
//        TestDataPreparer.prepareBasicTestData();
//    }
//}