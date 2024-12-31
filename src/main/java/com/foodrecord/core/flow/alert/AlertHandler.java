package com.foodrecord.core.flow.alert;

public interface AlertHandler {
    boolean canHandle(Alert alert);
    void handle(Alert alert);
} 