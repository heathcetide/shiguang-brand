//
//package com.foodrecord.core.logging;
//
//import com.foodrecord.core.db.health.PerformanceAnalysis;
//import org.springframework.stereotype.Service;
//import javax.sql.DataSource;
//import java.util.List;
//
//public interface PerformanceAnalyzer {
//    PerformanceAnalysis analyze(List<ParsedLog> logs);
//    PerformanceAnalysis analyze(DataSource dataSource);
//    PerformanceAnalysis analyzeWithMetrics(List<ParsedLog> logs, List<String> metricNames);
//
////    PerformanceMetrics analyze(List<ParsedLog> logs, TimeWindow window);
//}