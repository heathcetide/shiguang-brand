package com.foodrecord.common.exception;

/**
 * 幂等性异常
 * 
 * @author yourname
 * @since 1.0.0
 */
public class IdempotentException extends RuntimeException {
    public IdempotentException(String message) {
        super(message);
    }
} 