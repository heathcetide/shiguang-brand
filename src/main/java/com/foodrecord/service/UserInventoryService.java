package com.foodrecord.service;

import com.foodrecord.model.entity.user.UserInventory;
import org.springframework.format.annotation.DateTimeFormat;

import java.util.Date;
import java.util.List;
import java.util.Map;

public interface UserInventoryService {
    
    List<UserInventory> getAllByUserId(Long userId);
    
    List<UserInventory> getExpiringSoon(Long userId);
    
    List<UserInventory> getLowStock(Long userId);
    
    void addInventory(UserInventory inventory);
    
    void updateInventory(UserInventory inventory);
    
    void deleteInventory(Long id);
    
    Map<String, List<UserInventory>> getByCategory(Long userId, String category);
    
    Map<String, List<UserInventory>> getByLocation(Long userId, String location);
    
    Map<String, Object> getStatistics(Long userId);
    
    void batchAddInventory(List<UserInventory> inventories);
    
    void batchUpdateInventory(List<UserInventory> inventories);
    
    void batchDeleteInventory(List<Long> ids);
    
    List<UserInventory> searchInventory(Long userId, String keyword);
    
    List<UserInventory> getExpiringBetween(Long userId, Date startDate, Date endDate);
    
    List<UserInventory> getPurchasedBetween(Long userId, Date startDate, Date endDate);
    
    Map<String, List<UserInventory>> getBySource(Long userId, String source);
    
    void updateQuantity(Long id, Float quantity);
    
    void updateExpirationDate(Long id, Date expirationDate);
    
    void updateStorageLocation(Long id, String location);
    
    List<Map<String, Object>> getInventoryAlerts(Long userId);
    
    List<Map<String, Object>> getUsageHistory(Long userId, Date startDate, Date endDate);
    
    void recordConsumption(Long id, Float quantity, Date consumptionDate);
    
    List<Map<String, Object>> getInventorySuggestions(Long userId);
    
    List<Map<String, Object>> getShoppingListSuggestions(Long userId);
    
    Map<String, Object> getNutritionAnalysis(Long userId);
    
    Map<String, Object> getCostAnalysis(Long userId, Date startDate, Date endDate);
    
    Map<String, Object> getWasteAnalysis(Long userId, Date startDate, Date endDate);
    
    Map<String, Object> getConsumptionPatterns(Long userId);
    
    void transferInventory(Long id, String newLocation, Date transferDate, String reason);
    
    void splitInventory(Long id, Float splitQuantity, String newLocation);
    
    void mergeInventory(Long id, Long mergeId);
    
    void recordQualityCheck(Long id, String checkResult, Date checkDate, String notes);
    
    List<Map<String, Object>> getStorageOptimization(Long userId);
    
    List<Map<String, Object>> getExpirationForecast(Long userId, Integer days);
    
    Map<String, Object> getSeasonalAnalysis(Long userId);
    
    void shareInventory(Long id, Long targetUserId, Float shareQuantity, String notes);
    
    List<Map<String, Object>> getInventoryBasedRecipes(Long userId, String recipeType, String difficultyLevel);
    
    Map<String, Object> getMealPlan(Long userId, Integer days);
    
    void addInventoryLabel(Long id, String label, String labelType);
    
    void removeInventoryLabel(Long id, String label);
    
    List<Map<String, Object>> getInventoryLabels(Long userId);
    
    void addInventoryNote(Long id, String content, String noteType);
    
    List<Map<String, Object>> getInventoryNotes(Long id);
    
    Map<String, Object> getInventoryReports(Long userId, String reportType, Date startDate, Date endDate);
}
