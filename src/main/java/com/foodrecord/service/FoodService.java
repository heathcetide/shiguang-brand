package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import org.springframework.data.domain.Pageable;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

public interface FoodService extends IService<Food> {
    Food getById(Long id);

    List<Food> getByCategory(String category);

    Food createFood(FoodDTO foodDTO);

    Food updateFood(Long id, FoodDTO foodDTO);

    Food getFoodById(Long id);

    void deleteFood(Long id);

    List<Food> getHotFoods(int limit);

    Food updateFoodById(Food food);

    /**
     * 分页获取所有食物
     *
     * @param pageable 分页信息
     * @return 分页的食物数据
     */
    Page<Food> getAllFoods(Pageable pageable);

    List<Food> searchFoodsByName(String name);

    Food saveFood(Food food);

    Food findByCode(String code);

    Page<Food> getFoods(Page<Food> page, String keyword);

    boolean deleteFoodById(Long id);

    void batchDeleteFoods(List<Long> foodIds);

    Food toggleFoodStatus(Long id);

    List<Food> searchFoods(String keyword);

    List<Map<String, Object>> selectCountByField(String field);
}
