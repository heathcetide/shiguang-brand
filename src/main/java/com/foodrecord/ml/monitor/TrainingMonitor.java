package com.foodrecord.ml.monitor;

import org.deeplearning4j.nn.api.Model;
import org.deeplearning4j.optimize.api.BaseTrainingListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class TrainingMonitor extends BaseTrainingListener {
    private static final Logger log = LoggerFactory.getLogger(TrainingMonitor.class);
    private Map<Integer, Double> scoreHistory = new ConcurrentHashMap<>();
    private long startTime;

    public void onEpochEnd(Model model, int epoch) {
        double score = model.score();
        scoreHistory.put(epoch, score);
        if (epoch == 0) {
            startTime = System.currentTimeMillis();
        }
        if (epoch % 10 == 0) {
            log.info("Epoch {} completed. Score: {}", epoch, score);
            log.info("Time elapsed: {} seconds", (System.currentTimeMillis() - startTime) / 1000);
        }
    }
    
    public Map<Integer, Double> getScoreHistory() {
        return scoreHistory;
    }
} 