package com.foodrecord.core.disaster;

public class BackupVerificationException extends RuntimeException {
    public BackupVerificationException(String message) {
        super(message);
    }

    public BackupVerificationException(String message, Throwable cause) {
        super(message, cause);
    }
} 