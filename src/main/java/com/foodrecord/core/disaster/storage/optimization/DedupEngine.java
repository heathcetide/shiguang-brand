package com.foodrecord.core.disaster.storage.optimization;

import org.springframework.stereotype.Service;

public interface DedupEngine {
    DedupStrategy createStrategy(StorageCharacteristics characteristics);
}
