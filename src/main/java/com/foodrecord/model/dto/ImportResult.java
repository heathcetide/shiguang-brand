package com.foodrecord.model.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 导入结果
 */

public class ImportResult {
    // 食物导入结果
    private List<ImportResultItem> foodResults = new ArrayList<>();
    
    // 记录导入结果
    private List<ImportResultItem> recordResults = new ArrayList<>();
    
    // 总记录数
    public int getTotalCount() {
        return foodResults.size() + recordResults.size();
    }
    
    // 成功记录数
    public int getSuccessCount() {
        return (int) (foodResults.stream().filter(ImportResultItem::isSuccess).count() +
                     recordResults.stream().filter(ImportResultItem::isSuccess).count());
    }
    
    // 失败记录数
    public int getFailureCount() {
        return getTotalCount() - getSuccessCount();
    }

    public List<ImportResultItem> getFoodResults() {
        return foodResults;
    }

    public void setFoodResults(List<ImportResultItem> foodResults) {
        this.foodResults = foodResults;
    }

    public List<ImportResultItem> getRecordResults() {
        return recordResults;
    }

    public void setRecordResults(List<ImportResultItem> recordResults) {
        this.recordResults = recordResults;
    }
}