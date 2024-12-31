package com.foodrecord.core.db.routing.analysis;

import com.foodrecord.core.db.routing.AdaptiveDataSourceRouter.LoadImpact;
import com.foodrecord.core.db.routing.AdaptiveDataSourceRouter.QueryCharacteristics;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;

public interface LoadPredictor {
    LoadImpact predictImpact(QueryCharacteristics queryChars);
}

@Service("loadPredictorImpl")
@Primary
class LoadPredictorImpl implements LoadPredictor {
    @Override
    public LoadImpact predictImpact(QueryCharacteristics queryChars) {
        // 实现负载预测逻辑
        return null;
    }
} 