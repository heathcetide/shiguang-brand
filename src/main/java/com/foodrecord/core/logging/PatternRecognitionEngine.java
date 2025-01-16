// TODO ml - module
//package com.foodrecord.core.logging;
//
//import org.springframework.stereotype.Component;
//import java.util.*;
//
//@Component
//public class PatternRecognitionEngine {
//
//    public List<RecognizedPattern> recognizePatterns(ParsedLog logEntry) {
//        List<RecognizedPattern> patterns = new ArrayList<>();
//
//        // 错误模式识别
//        if (logEntry.getLevel() == ParsedLog.LogLevel.ERROR) {
//            patterns.add(new RecognizedPattern(
//                "ERROR_PATTERN",
//                "Error pattern detected: " + extractErrorMessage(logEntry),
//                1,  // 频率初始值为1
//                determineSeverity(logEntry)
//            ));
//        }
//
//        // 性能模式识别
//        if (hasPerformanceIssue(logEntry)) {
//            patterns.add(new RecognizedPattern(
//                "PERFORMANCE_PATTERN",
//                "Performance issue detected: " + extractPerformanceMetrics(logEntry),
//                1,
//                Severity.MEDIUM
//            ));
//        }
//
//        // 安全模式识别
//        if (hasSecurityIssue(logEntry)) {
//            patterns.add(new RecognizedPattern(
//                "SECURITY_PATTERN",
//                "Security issue detected: " + extractSecurityContext(logEntry),
//                1,
//                Severity.HIGH
//            ));
//        }
//
//        return patterns;
//    }
//
//    private String extractErrorMessage(ParsedLog logEntry) {
//        String message = logEntry.getMessage();
//        if (message.length() > 100) {
//            return message.substring(0, 100) + "...";
//        }
//        return message;
//    }
//
//    private boolean hasPerformanceIssue(ParsedLog logEntry) {
//        Map<String, String> metadata = logEntry.getMetadata();
//        String responseTime = metadata.get("responseTime");
//        if (responseTime != null) {
//            try {
//                return Double.parseDouble(responseTime) > 1000; // 响应时间超过1秒
//            } catch (NumberFormatException e) {
//                return false;
//            }
//        }
//        return false;
//    }
//
//    private String extractPerformanceMetrics(ParsedLog logEntry) {
//        Map<String, String> metadata = logEntry.getMetadata();
//        StringBuilder metrics = new StringBuilder();
//
//        if (metadata.containsKey("responseTime")) {
//            metrics.append("Response time: ").append(metadata.get("responseTime")).append("ms");
//        }
//        if (metadata.containsKey("cpuUsage")) {
//            metrics.append(", CPU usage: ").append(metadata.get("cpuUsage")).append("%");
//        }
//        if (metadata.containsKey("memoryUsage")) {
//            metrics.append(", Memory usage: ").append(metadata.get("memoryUsage")).append("MB");
//        }
//
//        return metrics.length() > 0 ? metrics.toString() : "Performance metrics not available";
//    }
//
//    private boolean hasSecurityIssue(ParsedLog logEntry) {
//        String message = logEntry.getMessage().toLowerCase();
//        return message.contains("unauthorized") ||
//               message.contains("forbidden") ||
//               message.contains("authentication failed") ||
//               message.contains("invalid token");
//    }
//
//    private String extractSecurityContext(ParsedLog logEntry) {
//        Map<String, String> metadata = logEntry.getMetadata();
//        String ipAddress = metadata.getOrDefault("ipAddress", "unknown");
//        String user = metadata.getOrDefault("user", "unknown");
//        return String.format("IP: %s, User: %s", ipAddress, user);
//    }
//
//    private Severity determineSeverity(ParsedLog logEntry) {
//        String message = logEntry.getMessage().toLowerCase();
//        if (message.contains("critical") || message.contains("fatal")) {
//            return Severity.CRITICAL;
//        } else if (message.contains("error")) {
//            return Severity.HIGH;
//        } else if (message.contains("warn")) {
//            return Severity.MEDIUM;
//        }
//        return Severity.LOW;
//    }
//}