package com.foodrecord.common.exception;

/**
 * 数据完整性异常
 * 当数据完整性校验失败时抛出
 * 
 * @author yourname
 * @since 1.0.0
 */
public class DataIntegrityException extends RuntimeException {
    public DataIntegrityException(String message) {
        super(message);
    }
} 