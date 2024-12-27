package com.foodrecord.abtest.monitor;

import java.util.ArrayList;
import java.util.List;

public class ExperimentHealth {
    private boolean sampleSizeAdequate;
    private boolean trafficAllocationCorrect;
    private boolean dataQualityGood;
    private List<String> issues = new ArrayList<>();
    private boolean critical;

    public void addIssue(String issue) {
        issues.add(issue);
    }

    public boolean isHealthy() {
        return issues.isEmpty() && sampleSizeAdequate && 
               trafficAllocationCorrect && dataQualityGood;
    }

    public boolean isCritical() {
        return critical || issues.size() > 3;
    }

    public boolean isSampleSizeAdequate() {
        return sampleSizeAdequate;
    }

    public void setSampleSizeAdequate(boolean sampleSizeAdequate) {
        this.sampleSizeAdequate = sampleSizeAdequate;
    }

    public boolean isTrafficAllocationCorrect() {
        return trafficAllocationCorrect;
    }

    public void setTrafficAllocationCorrect(boolean trafficAllocationCorrect) {
        this.trafficAllocationCorrect = trafficAllocationCorrect;
    }

    public boolean isDataQualityGood() {
        return dataQualityGood;
    }

    public void setDataQualityGood(boolean dataQualityGood) {
        this.dataQualityGood = dataQualityGood;
    }

    public List<String> getIssues() {
        return issues;
    }

    public void setIssues(List<String> issues) {
        this.issues = issues;
    }

    public void setCritical(boolean critical) {
        this.critical = critical;
    }
}