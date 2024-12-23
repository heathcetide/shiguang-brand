package com.foodrecord.model.vo;

import java.util.Map;

public class SentimentAnalysisResult {
    private Map<String, Long> sentimentStats;
    private String summary;

    // 构造方法
    public SentimentAnalysisResult(Map<String, Long> sentimentStats, String summary) {
        this.sentimentStats = sentimentStats;
        this.summary = summary;
    }

    // Getter 和 Setter
    public Map<String, Long> getSentimentStats() {
        return sentimentStats;
    }

    public void setSentimentStats(Map<String, Long> sentimentStats) {
        this.sentimentStats = sentimentStats;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }
}
