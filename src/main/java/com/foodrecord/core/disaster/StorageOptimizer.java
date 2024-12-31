package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

@Service
public interface StorageOptimizer {
    StorageOptimization optimize(IntelligentBackupManager.ChangeAnalysis changes);
}

class StorageOptimization {
    private final int compressionLevel;
    private final boolean deduplication;
    private final String storageClass;

    public StorageOptimization(int compressionLevel, boolean deduplication, String storageClass) {
        this.compressionLevel = compressionLevel;
        this.deduplication = deduplication;
        this.storageClass = storageClass;
    }

    public int getCompressionLevel() {
        return compressionLevel;
    }

    public boolean isDeduplication() {
        return deduplication;
    }

    public String getStorageClass() {
        return storageClass;
    }
} 