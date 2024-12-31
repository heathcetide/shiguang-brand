package com.foodrecord.core.disaster;

public class BackupStrategy {
    private final BackupType type;
    private final int priority;
    private final RetentionPolicy retentionPolicy;
    private final VerificationLevel verificationLevel;

    private BackupStrategy(Builder builder) {
        this.type = builder.type;
        this.priority = builder.priority;
        this.retentionPolicy = builder.retentionPolicy;
        this.verificationLevel = builder.verificationLevel;
    }

    public static Builder builder() {
        return new Builder();
    }

    public BackupType getType() {
        return type;
    }

    public int getPriority() {
        return priority;
    }

    public RetentionPolicy getRetentionPolicy() {
        return retentionPolicy;
    }

    public VerificationLevel getVerificationLevel() {
        return verificationLevel;
    }

    public static class Builder {
        private BackupType type;
        private int priority;
        private RetentionPolicy retentionPolicy;
        private VerificationLevel verificationLevel;

        public Builder type(BackupType type) {
            this.type = type;
            return this;
        }

        public Builder priority(int priority) {
            this.priority = priority;
            return this;
        }

        public Builder retentionPolicy(RetentionPolicy policy) {
            this.retentionPolicy = policy;
            return this;
        }

        public Builder verificationLevel(VerificationLevel level) {
            this.verificationLevel = level;
            return this;
        }

        public BackupStrategy build() {
            return new BackupStrategy(this);
        }
    }
}

enum RetentionPolicy {
    SHORT_TERM,
    MEDIUM_TERM,
    LONG_TERM,
    PERMANENT
}

enum VerificationLevel {
    BASIC,
    STANDARD,
    THOROUGH,
    COMPREHENSIVE
} 