package com.foodrecord.core.optimization;

public class CacheSuggestion {
    private final Type type;
    private final String description;
    private final Long value;

    public CacheSuggestion(Type type, String description, Long value) {
        this.type = type;
        this.description = description;
        this.value = value;
    }

    public Type getType() {
        return type;
    }

    public String getDescription() {
        return description;
    }

    public Long getValue() {
        return value;
    }

    public enum Type {
        INCREASE_TTL,
        REDUCE_SIZE,
        CHANGE_STRATEGY
    }
} 