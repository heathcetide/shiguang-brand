package com.foodrecord.test.data;//package com.foodrecord.test.data;
//
//import org.springframework.stereotype.Component;
//import lombok.extern.slf4j.Slf4j;
//import java.util.concurrent.atomic.AtomicInteger;
//
//@Slf4j
//@Component
//public class TestDataPreparer {
//    private final DatabaseCleaner databaseCleaner;
//    private final TestDataGenerator dataGenerator;
//    private final AtomicInteger testDataCounter = new AtomicInteger(0);
//
//    public void prepareTestData(TestDataSpec spec) {
//        log.info("Preparing test data with spec: {}", spec);
//
//        // 1. 清理旧数据
//        if (spec.isCleanBeforePrepare()) {
//            databaseCleaner.cleanData(spec.getTargetTables());
//        }
//
//        // 2. 生成基础数据
//        TestDataSet baseData = dataGenerator.generateBaseData(spec);
//
//        // 3. 生成关联数据
//        TestDataSet relatedData = dataGenerator.generateRelatedData(baseData);
//
//        // 4. 应用数据变异
//        if (spec.getDataMutations() != null) {
//            applyDataMutations(baseData, spec.getDataMutations());
//        }
//
//        // 5. 验证数据完整性
//        validateTestData(baseData, relatedData);
//    }
//
//    @Data
//    @Builder
//    public static class TestDataSpec {
//        private final String testCase;
//        private final int dataVolume;
//        private final Set<String> targetTables;
//        private final List<DataMutation> dataMutations;
//        private final boolean cleanBeforePrepare;
//        private final DataValidationRules validationRules;
//    }
//}