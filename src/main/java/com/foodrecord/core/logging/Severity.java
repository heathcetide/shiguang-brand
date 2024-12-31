package com.foodrecord.core.logging;

public enum Severity {
    CRITICAL(1),
    HIGH(2),
    MEDIUM(3),
    LOW(4);

    private final int level;

    Severity(int level) {
        this.level = level;
    }

    public int getLevel() {
        return level;
    }

    public boolean isHigherThan(Severity other) {
        return this.level < other.level;
    }

    public boolean isLowerThan(Severity other) {
        return this.level > other.level;
    }
} 