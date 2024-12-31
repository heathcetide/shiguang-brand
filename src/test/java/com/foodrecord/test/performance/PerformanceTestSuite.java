package com.foodrecord.test.performance;//package com.foodrecord.test.performance;
//
//import org.openjdk.jmh.annotations.*;
//import java.util.concurrent.TimeUnit;
//import lombok.extern.slf4j.Slf4j;
//
//@Slf4j
//@State(Scope.Benchmark)
//@BenchmarkMode(Mode.AverageTime)
//@OutputTimeUnit(TimeUnit.MILLISECONDS)
//public class PerformanceTestSuite {
//
//    private TestEnvironment testEnv;
//
//    @Setup
//    public void setup() {
//        testEnv = new TestEnvironment();
//        testEnv.initialize();
//    }
//
//    @Benchmark
//    @Group("backup")
//    @GroupThreads(4)
//    public void testBackupPerformance() {
//        testEnv.getBackupManager().performFullBackup();
//    }
//
//    @Benchmark
//    @Group("recovery")
//    @GroupThreads(2)
//    public void testRecoveryPerformance() {
//        testEnv.getRecoveryManager().performRecovery();
//    }
//
//    @TearDown
//    public void tearDown() {
//        testEnv.cleanup();
//    }
//}