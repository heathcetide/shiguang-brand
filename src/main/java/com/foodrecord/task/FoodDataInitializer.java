package com.foodrecord.task;

import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.model.entity.Food;
import com.foodrecord.repository.FoodRepository;
import com.foodrecord.service.FoodService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;

@Component
public class FoodDataInitializer {

    @Autowired
    private FoodRepository foodRepository;

    @Resource
    private FoodMapper foodMapper;

    @PostConstruct
    public void init() {
        System.out.println("开始收集数据");
        List<Food> foodList = foodMapper.selectAllFoods();
        for (Food food : foodList) {
            food.setPrompt(new String[]{food.getName(),food.getCode(),"健康", "营养", "美味"});
        }
        foodRepository.saveAll(foodList);
    }
}