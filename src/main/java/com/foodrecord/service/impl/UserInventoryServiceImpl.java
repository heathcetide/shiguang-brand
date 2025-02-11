package com.foodrecord.service.impl;

import com.foodrecord.mapper.UserInventoryMapper;
import com.foodrecord.model.entity.UserInventory;
import com.foodrecord.service.UserInventoryService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class UserInventoryServiceImpl implements UserInventoryService {

    @Resource
    private UserInventoryMapper userInventoryMapper;

    @Override
    public List<UserInventory> getAllByUserId(Long userId) {
        return userInventoryMapper.selectAllByUserId(userId);
    }

    @Override
    public List<UserInventory> getExpiringSoon(Long userId) {
        return userInventoryMapper.selectExpiringSoon(userId, 7); // 默认7天内过期
    }

    @Override
    public List<UserInventory> getLowStock(Long userId) {
        return userInventoryMapper.selectLowStock(userId);
    }

    @Override
    @Transactional
    public void addInventory(UserInventory inventory) {
        inventory.setCreatedAt(LocalDateTime.now());
        inventory.setUpdatedAt(LocalDateTime.now());
        userInventoryMapper.insert(inventory);
    }

    @Override
    @Transactional
    public void updateInventory(UserInventory inventory) {
        inventory.setUpdatedAt(LocalDateTime.now());
        userInventoryMapper.updateById(inventory);
    }

    @Override
    @Transactional
    public void deleteInventory(Long id) {
        UserInventory inventory = new UserInventory();
        inventory.setId(id);
//        inventory.setIsDeleted(true);
        inventory.setUpdatedAt(LocalDateTime.now());
        userInventoryMapper.updateById(inventory);
    }

    @Override
    public Map<String, List<UserInventory>> getByCategory(Long userId, String category) {
        List<UserInventory> inventories = userInventoryMapper.selectByCategory(userId, category);
        return inventories.stream()
                .collect(Collectors.groupingBy(UserInventory::getUsageCategory));
    }

    @Override
    public Map<String, List<UserInventory>> getByLocation(Long userId, String location) {
        List<UserInventory> inventories = userInventoryMapper.selectByLocation(userId, location);
        return inventories.stream()
                .collect(Collectors.groupingBy(UserInventory::getStorageLocation));
    }

    @Override
    public Map<String, Object> getStatistics(Long userId) {
        return userInventoryMapper.selectStatistics(userId);
    }

    @Override
    @Transactional
    public void batchAddInventory(List<UserInventory> inventories) {
        Date now = new Date();
        inventories.forEach(inventory -> {
            inventory.setCreatedAt(LocalDateTime.now());
            inventory.setUpdatedAt(LocalDateTime.now());
        });
        userInventoryMapper.batchInsert(inventories);
    }

    @Override
    @Transactional
    public void batchUpdateInventory(List<UserInventory> inventories) {
        Date now = new Date();
        inventories.forEach(inventory -> inventory.setUpdatedAt(LocalDateTime.now()));
        userInventoryMapper.batchUpdate(inventories);
    }

    @Override
    @Transactional
    public void batchDeleteInventory(List<Long> ids) {
        Date now = new Date();
        ids.forEach(id -> {
            UserInventory inventory = new UserInventory();
            inventory.setId(id);
//            inventory.setIsDeleted(true);
            inventory.setUpdatedAt(LocalDateTime.now());
            userInventoryMapper.updateById(inventory);
        });
    }

    @Override
    public List<UserInventory> searchInventory(Long userId, String keyword) {
        return userInventoryMapper.searchByKeyword(userId, keyword);
    }

    @Override
    public List<UserInventory> getExpiringBetween(Long userId, Date startDate, Date endDate) {
        return userInventoryMapper.selectExpiringBetween(userId, startDate, endDate);
    }

    @Override
    public List<UserInventory> getPurchasedBetween(Long userId, Date startDate, Date endDate) {
        return userInventoryMapper.selectPurchasedBetween(userId, startDate, endDate);
    }

    @Override
    public Map<String, List<UserInventory>> getBySource(Long userId, String source) {
        List<UserInventory> inventories = userInventoryMapper.selectBySource(userId, source);
        return inventories.stream()
                .collect(Collectors.groupingBy(UserInventory::getSource));
    }

    @Override
    @Transactional
    public void updateQuantity(Long id, Float quantity) {
        userInventoryMapper.updateQuantity(id, quantity);
    }

    @Override
    @Transactional
    public void updateExpirationDate(Long id, Date expirationDate) {
        userInventoryMapper.updateExpirationDate(id, expirationDate);
    }

    @Override
    @Transactional
    public void updateStorageLocation(Long id, String location) {
        userInventoryMapper.updateStorageLocation(id, location);
    }

    @Override
    public List<Map<String, Object>> getInventoryAlerts(Long userId) {
        return userInventoryMapper.selectInventoryAlerts(userId);
    }

    @Override
    public List<Map<String, Object>> getUsageHistory(Long userId, Date startDate, Date endDate) {
        return userInventoryMapper.selectUsageHistory(userId, startDate, endDate);
    }

    @Override
    @Transactional
    public void recordConsumption(Long id, Float quantity, Date consumptionDate) {
        userInventoryMapper.recordConsumption(id, quantity, consumptionDate);
    }

    @Override
    public List<Map<String, Object>> getInventorySuggestions(Long userId) {
        return userInventoryMapper.selectInventorySuggestions(userId);
    }

    @Override
    public List<Map<String, Object>> getShoppingListSuggestions(Long userId) {
        return userInventoryMapper.selectShoppingListSuggestions(userId);
    }

    @Override
    public Map<String, Object> getNutritionAnalysis(Long userId) {
        return userInventoryMapper.selectNutritionAnalysis(userId);
    }

    @Override
    public Map<String, Object> getCostAnalysis(Long userId, Date startDate, Date endDate) {
        return userInventoryMapper.selectCostAnalysis(userId, startDate, endDate);
    }

    @Override
    public Map<String, Object> getWasteAnalysis(Long userId, Date startDate, Date endDate) {
        return userInventoryMapper.selectWasteAnalysis(userId, startDate, endDate);
    }

    @Override
    public Map<String, Object> getConsumptionPatterns(Long userId) {
        return userInventoryMapper.selectConsumptionPatterns(userId);
    }

    @Override
    @Transactional
    public void transferInventory(Long id, String newLocation, Date transferDate, String reason) {
        userInventoryMapper.recordTransfer(id, newLocation, transferDate, reason);
    }

    @Override
    @Transactional
    public void splitInventory(Long id, Float splitQuantity, String newLocation) {
        userInventoryMapper.splitInventory(id, splitQuantity, newLocation);
    }

    @Override
    @Transactional
    public void mergeInventory(Long id, Long mergeId) {
        userInventoryMapper.mergeInventory(id, mergeId);
    }

    @Override
    @Transactional
    public void recordQualityCheck(Long id, String checkResult, Date checkDate, String notes) {
        userInventoryMapper.recordQualityCheck(id, checkResult, checkDate, notes);
    }

    @Override
    public List<Map<String, Object>> getStorageOptimization(Long userId) {
        return userInventoryMapper.selectStorageOptimization(userId);
    }

    @Override
    public List<Map<String, Object>> getExpirationForecast(Long userId, Integer days) {
        return userInventoryMapper.selectExpirationForecast(userId, days);
    }

    @Override
    public Map<String, Object> getSeasonalAnalysis(Long userId) {
        return userInventoryMapper.selectSeasonalAnalysis(userId);
    }

    @Override
    @Transactional
    public void shareInventory(Long id, Long targetUserId, Float shareQuantity, String notes) {
        userInventoryMapper.shareInventory(id, targetUserId, shareQuantity, notes);
    }

    @Override
    public List<Map<String, Object>> getInventoryBasedRecipes(Long userId, String recipeType, String difficultyLevel) {
        return userInventoryMapper.selectInventoryBasedRecipes(userId, recipeType, difficultyLevel);
    }

    @Override
    public Map<String, Object> getMealPlan(Long userId, Integer days) {
        return userInventoryMapper.selectMealPlan(userId, days);
    }

    @Override
    @Transactional
    public void addInventoryLabel(Long id, String label, String labelType) {
        userInventoryMapper.addInventoryLabel(id, label, labelType);
    }

    @Override
    @Transactional
    public void removeInventoryLabel(Long id, String label) {
        userInventoryMapper.removeInventoryLabel(id, label);
    }

    @Override
    public List<Map<String, Object>> getInventoryLabels(Long userId) {
        return userInventoryMapper.selectInventoryLabels(userId);
    }

    @Override
    @Transactional
    public void addInventoryNote(Long id, String content, String noteType) {
        userInventoryMapper.addInventoryNote(id, content, noteType);
    }

    @Override
    public List<Map<String, Object>> getInventoryNotes(Long id) {
        return userInventoryMapper.selectInventoryNotes(id);
    }

    @Override
    public Map<String, Object> getInventoryReports(Long userId, String reportType, Date startDate, Date endDate) {
        return userInventoryMapper.selectInventoryReports(userId, reportType, startDate, endDate);
    }
}
