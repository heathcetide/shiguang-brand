package com.foodrecord.mapper;

import com.foodrecord.model.entity.Food;
import org.springframework.data.elasticsearch.repository.ElasticsearchRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface FoodRepository extends ElasticsearchRepository<Food, Long> {
}