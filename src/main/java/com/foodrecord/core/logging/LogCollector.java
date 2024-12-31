package com.foodrecord.core.logging;

import com.foodrecord.core.flow.dashboard.DashboardOverview.SystemMetrics;
import org.springframework.data.elasticsearch.core.ElasticsearchOperations;
import org.springframework.data.elasticsearch.core.mapping.IndexCoordinates;
import org.springframework.stereotype.Component;

@Component
public class LogCollector {
    
    private final ElasticsearchOperations elasticsearchOperations;
    private final LogParser logParser;
    private final LogAnalyzer logAnalyzer;

    public LogCollector(ElasticsearchOperations elasticsearchOperations, 
                       LogParser logParser, 
                       LogAnalyzer logAnalyzer) {
        this.elasticsearchOperations = elasticsearchOperations;
        this.logParser = logParser;
        this.logAnalyzer = logAnalyzer;
    }

    public void collectApplicationLogs(LogEvent logEvent) {
        // 解析日志
        ParsedLog parsedLog = logParser.parse(logEvent);
        
        // 存储到Elasticsearch
        elasticsearchOperations.save(parsedLog, IndexCoordinates.of("application-logs"));
        
        // 分析异常模式
        if (parsedLog.getLevel().equals("ERROR")) {
            logAnalyzer.analyzeErrorPattern(parsedLog);
        }
    }
    
    public void collectSystemMetrics(SystemMetrics metrics) {
        elasticsearchOperations.save(metrics, IndexCoordinates.of("system-metrics"));
        logAnalyzer.analyzeSystemHealth(metrics);
    }
} 