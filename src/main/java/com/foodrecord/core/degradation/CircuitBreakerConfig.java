package com.foodrecord.core.degradation;

import java.time.Duration;

public class CircuitBreakerConfig {
    private final int failureThreshold;
    private final long resetTimeout;
    private final int samplingWindowSize;
    private final double errorThresholdPercentage;
    private final Duration waitDurationInOpenState;
    private final int permittedNumberOfCallsInHalfOpenState;
    private final int minimumNumberOfCalls;
    private final Duration slidingWindowSize;

    private CircuitBreakerConfig(Builder builder) {
        this.failureThreshold = builder.failureThreshold;
        this.resetTimeout = builder.resetTimeout;
        this.samplingWindowSize = builder.samplingWindowSize;
        this.errorThresholdPercentage = builder.errorThresholdPercentage;
        this.waitDurationInOpenState = builder.waitDurationInOpenState;
        this.permittedNumberOfCallsInHalfOpenState = builder.permittedNumberOfCallsInHalfOpenState;
        this.minimumNumberOfCalls = builder.minimumNumberOfCalls;
        this.slidingWindowSize = builder.slidingWindowSize;
    }

    public static Builder custom() {
        return new Builder();
    }

    public static CircuitBreakerConfig ofDefaults() {
        return custom().build();
    }

    public int getFailureThreshold() {
        return failureThreshold;
    }

    public long getResetTimeout() {
        return resetTimeout;
    }

    public int getSamplingWindowSize() {
        return samplingWindowSize;
    }

    public double getErrorThresholdPercentage() {
        return errorThresholdPercentage;
    }

    public Duration getWaitDurationInOpenState() {
        return waitDurationInOpenState;
    }

    public int getPermittedNumberOfCallsInHalfOpenState() {
        return permittedNumberOfCallsInHalfOpenState;
    }

    public int getMinimumNumberOfCalls() {
        return minimumNumberOfCalls;
    }

    public Duration getSlidingWindowSize() {
        return slidingWindowSize;
    }

    public static class Builder {
        private int failureThreshold = 5;
        private long resetTimeout = 60000; // 60 seconds
        private int samplingWindowSize = 100;
        private double errorThresholdPercentage = 50.0;
        private Duration waitDurationInOpenState = Duration.ofSeconds(60);
        private int permittedNumberOfCallsInHalfOpenState = 10;
        private int minimumNumberOfCalls = 10;
        private Duration slidingWindowSize = Duration.ofSeconds(60);

        public Builder failureThreshold(int failureThreshold) {
            this.failureThreshold = failureThreshold;
            return this;
        }

        public Builder resetTimeout(long resetTimeout) {
            this.resetTimeout = resetTimeout;
            return this;
        }

        public Builder samplingWindowSize(int samplingWindowSize) {
            this.samplingWindowSize = samplingWindowSize;
            return this;
        }

        public Builder errorThresholdPercentage(double errorThresholdPercentage) {
            this.errorThresholdPercentage = errorThresholdPercentage;
            return this;
        }

        public Builder waitDurationInOpenState(Duration waitDurationInOpenState) {
            this.waitDurationInOpenState = waitDurationInOpenState;
            return this;
        }

        public Builder permittedNumberOfCallsInHalfOpenState(int permittedNumberOfCallsInHalfOpenState) {
            this.permittedNumberOfCallsInHalfOpenState = permittedNumberOfCallsInHalfOpenState;
            return this;
        }

        public Builder minimumNumberOfCalls(int minimumNumberOfCalls) {
            this.minimumNumberOfCalls = minimumNumberOfCalls;
            return this;
        }

        public Builder slidingWindowSize(Duration slidingWindowSize) {
            this.slidingWindowSize = slidingWindowSize;
            return this;
        }

        public CircuitBreakerConfig build() {
            return new CircuitBreakerConfig(this);
        }
    }
} 