package com.foodrecord.core.flow.alert;

import com.foodrecord.core.logging.*;
import java.util.List;

public class ErrorAlert {
    private final List<LogAnalyzer.ErrorPattern> patterns;
    private final ErrorImpactAnalysis impact;
    private final List<RemediationAction> actions;

    public ErrorAlert(List<LogAnalyzer.ErrorPattern> patterns, 
                     ErrorImpactAnalysis impact,
                     List<RemediationAction> actions) {
        this.patterns = patterns;
        this.impact = impact;
        this.actions = actions;
    }

    public List<LogAnalyzer.ErrorPattern> getPatterns() {
        return patterns;
    }

    public ErrorImpactAnalysis getImpact() {
        return impact;
    }

    public List<RemediationAction> getActions() {
        return actions;
    }
} 