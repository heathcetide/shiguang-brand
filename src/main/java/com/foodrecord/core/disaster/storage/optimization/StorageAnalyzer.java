package com.foodrecord.core.disaster.storage.optimization;

import com.foodrecord.core.disaster.BackupMetadata;
import org.springframework.stereotype.Service;

public interface StorageAnalyzer {
    StorageCharacteristics analyzeStorage(BackupMetadata metadata);
}
