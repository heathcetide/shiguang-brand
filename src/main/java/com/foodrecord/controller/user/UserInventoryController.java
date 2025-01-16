package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.entity.user.UserInventory;
import com.foodrecord.service.UserInventoryService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.util.Date;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/inventory")
@Api(tags = "用户库存模块")
public class UserInventoryController {

    @Autowired
    private UserInventoryService userInventoryService;

    /**
     * 聚合用户信息
     *
     * @param user          用户信息
     * @param inventoryList 用户库存
     * @return 聚合的用户信息字符串（供 AI 模块使用）
     */
    private String aggregateUserInfo(User user, List<UserInventory> inventoryList) {
        StringBuilder sb = new StringBuilder();
        sb.append("用户名称: ").append(user.getUsername()).append("\n");
//        sb.append("用户饮食偏好: ").append(user.getPreferences()).append("\n");
        sb.append("用户库存: ").append("\n");

        for (UserInventory inventory : inventoryList) {
            sb.append("- ").append(inventory.getCustomFoodName() != null ? inventory.getCustomFoodName() : inventory.getFoodId()).append(": ")
                    .append(inventory.getQuantity()).append(inventory.getUnit()).append("\n");
        }

        return sb.toString();
    }

    @GetMapping("/{userId}")
    @ApiOperation("获取用户所有库存")
    public List<UserInventory> getAllByUserId(@PathVariable Long userId) {
        return userInventoryService.getAllByUserId(userId);
    }

    @GetMapping("/{userId}/expiring-soon")
    @ApiOperation("获取即将过期的库存")
    public List<UserInventory> getExpiringSoon(@PathVariable Long userId) {
        return userInventoryService.getExpiringSoon(userId);
    }

    @GetMapping("/{userId}/low-stock")
    @ApiOperation("获取库存不足的物品")
    public List<UserInventory> getLowStock(@PathVariable Long userId) {
        return userInventoryService.getLowStock(userId);
    }

    @PostMapping
    @ApiOperation("添加库存")
    public ApiResponse addInventory(@RequestBody UserInventory inventory) {
        userInventoryService.addInventory(inventory);
        return ApiResponse.success(null);
    }

    @PutMapping
    @ApiOperation("更新库存")
    public ApiResponse<Void> updateInventory(@RequestBody UserInventory inventory) {
        userInventoryService.updateInventory(inventory);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/{id}")
    @ApiOperation("删除库存")
    public ApiResponse<Void> deleteInventory(@PathVariable Long id) {
        userInventoryService.deleteInventory(id);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/by-category")
    @ApiOperation("按类别获取库存")
    public Map<String, List<UserInventory>> getByCategory(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("类别") @RequestParam(required = false) String category) {
        return userInventoryService.getByCategory(userId, category);
    }

    @GetMapping("/{userId}/by-location")
    @ApiOperation("按存储位置获取库存")
    public Map<String, List<UserInventory>> getByLocation(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("存储位置") @RequestParam(required = false) String location) {
        return userInventoryService.getByLocation(userId, location);
    }

    @GetMapping("/{userId}/statistics")
    @ApiOperation("获取库存统计信息")
    public Map<String, Object> getStatistics(@PathVariable Long userId) {
        return userInventoryService.getStatistics(userId);
    }

    @PostMapping("/batch")
    @ApiOperation("批量添加库存")
    public ApiResponse<Void> batchAddInventory(@RequestBody List<UserInventory> inventories) {
        userInventoryService.batchAddInventory(inventories);
        return ApiResponse.success(null);
    }

    @PutMapping("/batch")
    @ApiOperation("批量更新库存")
    public ApiResponse<Void> batchUpdateInventory(@RequestBody List<UserInventory> inventories) {
        userInventoryService.batchUpdateInventory(inventories);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/batch")
    @ApiOperation("批量删除库存")
    public ApiResponse<Void> batchDeleteInventory(@RequestBody List<Long> ids) {
        userInventoryService.batchDeleteInventory(ids);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/search")
    @ApiOperation("搜索库存")
    public List<UserInventory> searchInventory(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("关键词") @RequestParam String keyword) {
        return userInventoryService.searchInventory(userId, keyword);
    }

    @GetMapping("/{userId}/expiring-between")
    @ApiOperation("获取指定日期范围内过期的库存")
    public List<UserInventory> getExpiringBetween(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("开始日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date startDate,
            @ApiParam("结束日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date endDate) {
        return userInventoryService.getExpiringBetween(userId, startDate, endDate);
    }

    @GetMapping("/{userId}/purchased-between")
    @ApiOperation("获取指定日期范围内购买的库存")
    public List<UserInventory> getPurchasedBetween(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("开始日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date startDate,
            @ApiParam("结束日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date endDate) {
        return userInventoryService.getPurchasedBetween(userId, startDate, endDate);
    }

    @GetMapping("/{userId}/by-source")
    @ApiOperation("按来源获取库存")
    public Map<String, List<UserInventory>> getBySource(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("来源") @RequestParam(required = false) String source) {
        return userInventoryService.getBySource(userId, source);
    }

    @PutMapping("/{id}/quantity")
    @ApiOperation("更新库存数量")
    public ApiResponse updateQuantity(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("数量") @RequestParam Float quantity) {
        userInventoryService.updateQuantity(id, quantity);
        return ApiResponse.success(null);
    }

    @PutMapping("/{id}/expiration-date")
    @ApiOperation("更新过期日期")
    public ApiResponse updateExpirationDate(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("过期日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date expirationDate) {
        userInventoryService.updateExpirationDate(id, expirationDate);
        return ApiResponse.success(null);
    }

    @PutMapping("/{id}/storage-location")
    @ApiOperation("更新存储位置")
    public ApiResponse updateStorageLocation(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("存储位置") @RequestParam String location) {
        userInventoryService.updateStorageLocation(id, location);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/alerts")
    @ApiOperation("获取库存警报")
    public List<Map<String, Object>> getInventoryAlerts(@PathVariable Long userId) {
        return userInventoryService.getInventoryAlerts(userId);
    }

    @GetMapping("/{userId}/usage-history")
    @ApiOperation("获取库存使用历史")
    public List<Map<String, Object>> getUsageHistory(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("开始日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date startDate,
            @ApiParam("结束日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date endDate) {
        return userInventoryService.getUsageHistory(userId, startDate, endDate);
    }

    @PostMapping("/{id}/consume")
    @ApiOperation("记录库存消耗")
    public ApiResponse recordConsumption(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("消耗数量") @RequestParam Float quantity,
            @ApiParam("消耗日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date consumptionDate) {
        userInventoryService.recordConsumption(id, quantity, consumptionDate);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/suggestions")
    @ApiOperation("获取库存管理建议")
    public List<Map<String, Object>> getInventorySuggestions(@PathVariable Long userId) {
        return userInventoryService.getInventorySuggestions(userId);
    }

    @GetMapping("/{userId}/shopping-list")
    @ApiOperation("获取购物清单建议")
    public List<Map<String, Object>> getShoppingListSuggestions(@PathVariable Long userId) {
        return userInventoryService.getShoppingListSuggestions(userId);
    }

    @GetMapping("/{userId}/nutrition-analysis")
    @ApiOperation("获取库存营养分析")
    public Map<String, Object> getNutritionAnalysis(@PathVariable Long userId) {
        return userInventoryService.getNutritionAnalysis(userId);
    }

    @GetMapping("/{userId}/cost-analysis")
    @ApiOperation("获取库存成本分析")
    public Map<String, Object> getCostAnalysis(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("开始日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date startDate,
            @ApiParam("结束日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date endDate) {
        return userInventoryService.getCostAnalysis(userId, startDate, endDate);
    }

    @GetMapping("/{userId}/waste-analysis")
    @ApiOperation("获取库存浪费分析")
    public Map<String, Object> getWasteAnalysis(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("开始日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date startDate,
            @ApiParam("结束日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date endDate) {
        return userInventoryService.getWasteAnalysis(userId, startDate, endDate);
    }

    @GetMapping("/{userId}/consumption-patterns")
    @ApiOperation("获取消费模式分析")
    public Map<String, Object> getConsumptionPatterns(@PathVariable Long userId) {
        return userInventoryService.getConsumptionPatterns(userId);
    }

    @PostMapping("/{id}/transfer")
    @ApiOperation("转移库存位置")
    public ApiResponse transferInventory(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("新位置") @RequestParam String newLocation,
            @ApiParam("转移日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date transferDate,
            @ApiParam("转移原因") @RequestParam(required = false) String reason) {
        userInventoryService.transferInventory(id, newLocation, transferDate, reason);
        return ApiResponse.success(null);
    }

    @PostMapping("/{id}/split")
    @ApiOperation("拆分库存")
    public ApiResponse splitInventory(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("拆分数量") @RequestParam Float splitQuantity,
            @ApiParam("新位置") @RequestParam(required = false) String newLocation) {
        userInventoryService.splitInventory(id, splitQuantity, newLocation);
        return ApiResponse.success(null);
    }

    @PostMapping("/{id}/merge")
    @ApiOperation("合并库存")
    public ApiResponse mergeInventory(
            @ApiParam("主库存ID") @PathVariable Long id,
            @ApiParam("被合并库存ID") @RequestParam Long mergeId) {
        userInventoryService.mergeInventory(id, mergeId);
        return ApiResponse.success(null);
    }

    @PostMapping("/{id}/quality-check")
    @ApiOperation("记录质量检查")
    public ApiResponse recordQualityCheck(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("检查结果") @RequestParam String checkResult,
            @ApiParam("检查日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date checkDate,
            @ApiParam("备注") @RequestParam(required = false) String notes) {
        userInventoryService.recordQualityCheck(id, checkResult, checkDate, notes);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/storage-optimization")
    @ApiOperation("获取存储优化建议")
    public List<Map<String, Object>> getStorageOptimization(@PathVariable Long userId) {
        return userInventoryService.getStorageOptimization(userId);
    }

    @GetMapping("/{userId}/expiration-forecast")
    @ApiOperation("获取过期预测")
    public List<Map<String, Object>> getExpirationForecast(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("预测天数") @RequestParam(defaultValue = "30") Integer days) {
        return userInventoryService.getExpirationForecast(userId, days);
    }

    @GetMapping("/{userId}/seasonal-analysis")
    @ApiOperation("获取季节性分析")
    public Map<String, Object> getSeasonalAnalysis(@PathVariable Long userId) {
        return userInventoryService.getSeasonalAnalysis(userId);
    }

    @PostMapping("/{id}/share")
    @ApiOperation("分享库存")
    public ApiResponse shareInventory(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("接收用户ID") @RequestParam Long targetUserId,
            @ApiParam("分享数量") @RequestParam Float shareQuantity,
            @ApiParam("分享备注") @RequestParam(required = false) String notes) {
        userInventoryService.shareInventory(id, targetUserId, shareQuantity, notes);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/recipes")
    @ApiOperation("获取基于当前库存的食谱推荐")
    public List<Map<String, Object>> getInventoryBasedRecipes(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("食谱类型") @RequestParam(required = false) String recipeType,
            @ApiParam("难度等级") @RequestParam(required = false) String difficultyLevel) {
        return userInventoryService.getInventoryBasedRecipes(userId, recipeType, difficultyLevel);
    }

    @GetMapping("/{userId}/meal-plan")
    @ApiOperation("获取基于库存的膳食计划")
    public Map<String, Object> getMealPlan(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("计划天数") @RequestParam(defaultValue = "7") Integer days) {
        return userInventoryService.getMealPlan(userId, days);
    }

    @PostMapping("/{id}/label")
    @ApiOperation("添加库存标签")
    public ApiResponse addInventoryLabel(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("标签") @RequestParam String label,
            @ApiParam("标签类型") @RequestParam(required = false) String labelType) {
        userInventoryService.addInventoryLabel(id, label, labelType);
        return ApiResponse.success(null);
    }

    @DeleteMapping("/{id}/label")
    @ApiOperation("删除库存标签")
    public ApiResponse removeInventoryLabel(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("标签") @RequestParam String label) {
        userInventoryService.removeInventoryLabel(id, label);
        return ApiResponse.success(null);
    }

    @GetMapping("/{userId}/labels")
    @ApiOperation("获取用户的所有库存标签")
    public List<Map<String, Object>> getInventoryLabels(@PathVariable Long userId) {
        return userInventoryService.getInventoryLabels(userId);
    }

    @PostMapping("/{id}/note")
    @ApiOperation("添加库存备注")
    public ApiResponse addInventoryNote(
            @ApiParam("库存ID") @PathVariable Long id,
            @ApiParam("备注内容") @RequestParam String content,
            @ApiParam("备注类型") @RequestParam(required = false) String noteType) {
        userInventoryService.addInventoryNote(id, content, noteType);
        return ApiResponse.success(null);
    }

    @GetMapping("/{id}/notes")
    @ApiOperation("获取库存的所有备注")
    public List<Map<String, Object>> getInventoryNotes(@PathVariable Long id) {
        return userInventoryService.getInventoryNotes(id);
    }

    @GetMapping("/{userId}/reports")
    @ApiOperation("获取库存报告")
    public Map<String, Object> getInventoryReports(
            @ApiParam("用户ID") @PathVariable Long userId,
            @ApiParam("报告类型") @RequestParam String reportType,
            @ApiParam("开始日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date startDate,
            @ApiParam("结束日期") @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") Date endDate) {
        return userInventoryService.getInventoryReports(userId, reportType, startDate, endDate);
    }
}
