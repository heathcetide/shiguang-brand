// TODO ml - module
//package com.foodrecord.core.logging;
//
//import org.springframework.stereotype.Component;
//import java.util.*;
//
//@Component
//public class ErrorPatternDetector {
//
//    public List<LogAnalyzer.ErrorPattern> detectPatterns(ParsedLog logEntry) {
//        List<LogAnalyzer.ErrorPattern> patterns = new ArrayList<>();
//
//        if (logEntry.getLevel() == ParsedLog.LogLevel.ERROR) {
//            patterns.add(createErrorPattern(logEntry));
//        }
//
//        return patterns;
//    }
//
//    private LogAnalyzer.ErrorPattern createErrorPattern(ParsedLog logEntry) {
//        Set<String> affectedServices = extractAffectedServices(logEntry);
//        Map<String, Integer> errorDistribution = analyzeErrorDistribution(logEntry);
//
//        return new LogAnalyzer.ErrorPattern(
//            extractErrorPattern(logEntry),
//            1,
//            logEntry.getTimestamp(),
//            logEntry.getTimestamp(),
//            affectedServices,
//            errorDistribution
//        );
//    }
//
//    private String extractErrorPattern(ParsedLog logEntry) {
//        // 提取错误模式
//        String message = logEntry.getMessage();
//        String stackTrace = logEntry.extractStackTrace(logEntry);
//        if (stackTrace != null) {
//            // 从堆栈跟踪中提取关键信息
//            return extractPatternFromStackTrace(stackTrace);
//        } else {
//            // 从错误消息中提取模式
//            return extractPatternFromMessage(message);
//        }
//    }
//
//    private String extractPatternFromStackTrace(String stackTrace) {
//        // 实现从堆栈跟踪提取模式的逻辑
//        String[] lines = stackTrace.split("\n");
//        if (lines.length > 0) {
//            return lines[0].trim();
//        }
//        return "Unknown Error Pattern";
//    }
//
//    private String extractPatternFromMessage(String message) {
//        // 实现从消息提取模式的逻辑
//        return message.split(":")[0].trim();
//    }
//
//    private Set<String> extractAffectedServices(ParsedLog logEntry) {
//        Set<String> services = new HashSet<>();
//        services.add(logEntry.getSource());
//        return services;
//    }
//
//    private Map<String, Integer> analyzeErrorDistribution(ParsedLog logEntry) {
//        Map<String, Integer> distribution = new HashMap<>();
//        distribution.put(logEntry.getLevel() == ParsedLog.LogLevel.ERROR ? "ERROR" : "INFO", 1);
//        return distribution;
//    }
//}