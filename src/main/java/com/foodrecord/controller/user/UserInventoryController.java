package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.entity.user.UserInventory;
import com.foodrecord.service.UserInventoryService;
import com.foodrecord.service.UserService;
import io.swagger.annotations.Api;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
@Api(tags = "用户库存模块")
public class UserInventoryController {

    @Autowired
    private UserInventoryService userInventoryService;

//    @Autowired
//    private UserService userService;
//
//    @Autowired
//    private AIRecipeService aiRecipeService;
//
//    @Autowired
//    private JwtUtils jwtUtils;
//
//    @GetMapping("/generate-meal-plan")
//    public ApiResponse<String> generateMealPlan(@RequestHeader("Authorization") String token) {
//        try {
//            // Step 1: 获取用户 ID
//            Long userIdFromToken = jwtUtils.getUserIdFromToken(token);
//
//            // Step 2: 查询当前用户的库存
//            List<UserInventory> inventoryList = userInventoryService.getAllByUserId(userIdFromToken);
//            if (inventoryList == null || inventoryList.isEmpty()) {
//                return ApiResponse.error(400, "当前用户没有库存记录");
//            }
//
//            // Step 3: 查询用户的相关信息
//            User user = userService.getUserById(userIdFromToken);
//            if (user == null) {
//                return ApiResponse.error(400, "用户信息不存在");
//            }
//
//            // Step 4: 聚合用户信息并对接 AI 模块生成菜谱
//            String aggregatedInfo = aggregateUserInfo(user, inventoryList);
//            List<String> recipes = aiRecipeService.getRecipesForMeal(aggregatedInfo);
//
//            // Step 5: 验证数据库中是否已有该菜谱记录
//            for (String recipe : recipes) {
//                boolean isRecipeExists = userInventoryService.isRecipeExists(recipe);
//                if (!isRecipeExists) {
//                    // Step 6: 如果没有，调用 AI 模块生成菜谱的图片信息
//                    String recipeImageUrl = aiRecipeService.generateRecipeImage(recipe);
//
//                    // Step 7: 保存新生成的菜谱到数据库
//                    userInventoryService.saveRecipe(recipe, recipeImageUrl);
//                }
//            }
//
//            return ApiResponse.success("今日菜谱生成成功");
//
//        } catch (Exception e) {
//            e.printStackTrace();
//            return ApiResponse.error(500, "系统异常，请稍后再试");
//        }
//    }

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
    public List<UserInventory> getAllByUserId(@PathVariable Long userId) {
        return userInventoryService.getAllByUserId(userId);
    }

    @GetMapping("/{userId}/expiring-soon")
    public List<UserInventory> getExpiringSoon(@PathVariable Long userId) {
        return userInventoryService.getExpiringSoon(userId);
    }

    @GetMapping("/{userId}/low-stock")
    public List<UserInventory> getLowStock(@PathVariable Long userId) {
        return userInventoryService.getLowStock(userId);
    }

    @PostMapping
    public void addInventory(@RequestBody UserInventory inventory) {
        userInventoryService.addInventory(inventory);
    }

    @PutMapping
    public void updateInventory(@RequestBody UserInventory inventory) {
        userInventoryService.updateInventory(inventory);
    }

    @DeleteMapping("/{id}")
    public void deleteInventory(@PathVariable Long id) {
        userInventoryService.deleteInventory(id);
    }
}
