package com.foodrecord.core.db.routing;

public enum LoadBalanceStrategy {
    ROUND_ROBIN,
    LEAST_CONNECTIONS,
    WEIGHTED_RANDOM,
    RANDOM,
    RESPONSE_TIME
} 