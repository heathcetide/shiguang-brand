package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

@Service
public interface BackupVerificationService {
    boolean verifyBackup(String backupId);
} 