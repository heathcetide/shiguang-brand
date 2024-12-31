package com.foodrecord.exception;

public class VideoProcessException extends RuntimeException {
    
    private Integer code;
    
    public VideoProcessException(String message) {
        super(message);
        this.code = 500;
    }
    
    public VideoProcessException(Integer code, String message) {
        super(message);
        this.code = code;
    }
    
    public Integer getCode() {
        return code;
    }
} 