package com.foodrecord.core.logging;

public class RecognizedPattern {
    private final String type;
    private final String description;
    private final int frequency;
    private final Severity severity;

    public RecognizedPattern(String type, String description, int frequency, Severity severity) {
        this.type = type;
        this.description = description;
        this.frequency = frequency;
        this.severity = severity;
    }

    public String getType() {
        return type;
    }

    public String getDescription() {
        return description;
    }

    public int getFrequency() {
        return frequency;
    }

    public Severity getSeverity() {
        return severity;
    }
} 