package com.foodrecord.service;

import com.foodrecord.model.entity.Food;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Map;

public interface FoodSearchService {
    Page<Food> search(String keyword, Page<Food> page);
    Map<String, Long> aggregateByHealthLight(); // 按健康灯聚合

    List<String> suggest(String prefix);
}