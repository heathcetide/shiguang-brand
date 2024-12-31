package com.foodrecord.core.logging;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class MetricsRepository {
    private final Map<String, PerformanceReport> reports = new HashMap<>();

    public void save(PerformanceReport report) {
        String id = UUID.randomUUID().toString();
        reports.put(id, report);
    }

    public Optional<PerformanceReport> findById(String id) {
        return Optional.ofNullable(reports.get(id));
    }

    public List<PerformanceReport> findAll() {
        return new ArrayList<>(reports.values());
    }

    public void deleteById(String id) {
        reports.remove(id);
    }
} 