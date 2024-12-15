package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Food;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Optional;

@Mapper
public interface FoodMapper extends BaseMapper<Food> {
    
    Food selectByCode(@Param("code") String code);
    
    List<Food> searchByName(@Param("name") String name);
    
    List<Food> selectByHealthLight(@Param("healthLight") Integer healthLight);
    
    Boolean checkCodeExists(@Param("code") String code);

    // 添加以下方法
    List<Food> selectByCategory(@Param("category") String category);

    boolean existsByCode(@Param("code") String code);

    List<Food> selectHotFoods(int limit);

    List<Food> searchFoodsByName(String name);

    Food findById(@Param("id") Long id);

}