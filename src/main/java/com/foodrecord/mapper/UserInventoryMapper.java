package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.user.UserInventory;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Date;
import java.util.List;
import java.util.Map;

@Mapper
public interface UserInventoryMapper extends BaseMapper<UserInventory> {
    
    List<UserInventory> selectAllByUserId(@Param("userId") Long userId);
    
    List<UserInventory> selectExpiringSoon(@Param("userId") Long userId, @Param("days") Integer days);
    
    List<UserInventory> selectLowStock(@Param("userId") Long userId);
    
    List<UserInventory> selectByCategory(@Param("userId") Long userId, @Param("category") String category);
    
    List<UserInventory> selectByLocation(@Param("userId") Long userId, @Param("location") String location);
    
    Map<String, Object> selectStatistics(@Param("userId") Long userId);
    
    void batchInsert(@Param("list") List<UserInventory> inventories);
    
    void batchUpdate(@Param("list") List<UserInventory> inventories);
    
    List<UserInventory> searchByKeyword(@Param("userId") Long userId, @Param("keyword") String keyword);
    
    List<UserInventory> selectExpiringBetween(
            @Param("userId") Long userId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate);
    
    List<UserInventory> selectPurchasedBetween(
            @Param("userId") Long userId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate);
    
    List<UserInventory> selectBySource(@Param("userId") Long userId, @Param("source") String source);
    
    void updateQuantity(@Param("id") Long id, @Param("quantity") Float quantity);
    
    void updateExpirationDate(@Param("id") Long id, @Param("expirationDate") Date expirationDate);
    
    void updateStorageLocation(@Param("id") Long id, @Param("location") String location);
    
    List<Map<String, Object>> selectInventoryAlerts(@Param("userId") Long userId);
    
    List<Map<String, Object>> selectUsageHistory(
            @Param("userId") Long userId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate);
    
    void recordConsumption(
            @Param("id") Long id,
            @Param("quantity") Float quantity,
            @Param("consumptionDate") Date consumptionDate);
    
    List<Map<String, Object>> selectInventorySuggestions(@Param("userId") Long userId);
    
    List<Map<String, Object>> selectShoppingListSuggestions(@Param("userId") Long userId);
    
    Map<String, Object> selectNutritionAnalysis(@Param("userId") Long userId);
    
    Map<String, Object> selectCostAnalysis(
            @Param("userId") Long userId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate);
    
    Map<String, Object> selectWasteAnalysis(
            @Param("userId") Long userId,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate);
    
    Map<String, Object> selectConsumptionPatterns(@Param("userId") Long userId);
    
    void recordTransfer(
            @Param("id") Long id,
            @Param("newLocation") String newLocation,
            @Param("transferDate") Date transferDate,
            @Param("reason") String reason);
    
    void splitInventory(
            @Param("id") Long id,
            @Param("splitQuantity") Float splitQuantity,
            @Param("newLocation") String newLocation);
    
    void mergeInventory(
            @Param("id") Long id,
            @Param("mergeId") Long mergeId);
    
    void recordQualityCheck(
            @Param("id") Long id,
            @Param("checkResult") String checkResult,
            @Param("checkDate") Date checkDate,
            @Param("notes") String notes);
    
    List<Map<String, Object>> selectStorageOptimization(@Param("userId") Long userId);
    
    List<Map<String, Object>> selectExpirationForecast(
            @Param("userId") Long userId,
            @Param("days") Integer days);
    
    Map<String, Object> selectSeasonalAnalysis(@Param("userId") Long userId);
    
    void shareInventory(
            @Param("id") Long id,
            @Param("targetUserId") Long targetUserId,
            @Param("shareQuantity") Float shareQuantity,
            @Param("notes") String notes);
    
    List<Map<String, Object>> selectInventoryBasedRecipes(
            @Param("userId") Long userId,
            @Param("recipeType") String recipeType,
            @Param("difficultyLevel") String difficultyLevel);
    
    Map<String, Object> selectMealPlan(
            @Param("userId") Long userId,
            @Param("days") Integer days);
    
    void addInventoryLabel(
            @Param("id") Long id,
            @Param("label") String label,
            @Param("labelType") String labelType);
    
    void removeInventoryLabel(
            @Param("id") Long id,
            @Param("label") String label);
    
    List<Map<String, Object>> selectInventoryLabels(@Param("userId") Long userId);
    
    void addInventoryNote(
            @Param("id") Long id,
            @Param("content") String content,
            @Param("noteType") String noteType);
    
    List<Map<String, Object>> selectInventoryNotes(@Param("id") Long id);
    
    Map<String, Object> selectInventoryReports(
            @Param("userId") Long userId,
            @Param("reportType") String reportType,
            @Param("startDate") Date startDate,
            @Param("endDate") Date endDate);
}
