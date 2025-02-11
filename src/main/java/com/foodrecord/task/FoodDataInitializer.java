package com.foodrecord.task;

import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.model.entity.Food;
import com.foodrecord.mapper.FoodRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.List;

@Component
public class FoodDataInitializer {

    @Autowired
    private FoodRepository foodRepository;

    @Resource
    private FoodMapper foodMapper;

//    @PostConstruct
    public void init() {
        int pageSize = 10000;  // 每次查询的数据量，可以根据实际情况调整
        int currentPage = 1;
        List<Food> foodList;

        // 分批次查询并同步
        do {
            foodList = foodMapper.selectFoodsByPage(currentPage, pageSize);
            for (Food food : foodList) {
                food.setPrompt(new String[]{food.getName(), food.getCode(), "健康", "营养", "美味"});
            }
            foodRepository.saveAll(foodList);  // 将当前批次数据保存到 Elasticsearch
            currentPage++;
        } while (foodList.size() == pageSize);  // 如果当前批次数据大小等于 pageSize，说明还有更多数据
    }


}