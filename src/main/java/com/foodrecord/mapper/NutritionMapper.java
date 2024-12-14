package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Nutrition;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Optional;

@Mapper
public interface NutritionMapper extends BaseMapper<Nutrition> {
    
    Nutrition selectByFoodId(@Param("foodId") Long foodId);
    
    Boolean existsByFoodId(@Param("foodId") Long foodId);
    
    // 根据营养素范围查询
    List<Nutrition> selectByNutrientRange(
        @Param("nutrientName") String nutrientName,
        @Param("minValue") Float minValue,
        @Param("maxValue") Float maxValue
    );

    /**
     * 根据食物ID查找营养信息
     */
    @Select("SELECT * FROM nutrition WHERE food_id = #{foodId}")
    Optional<Nutrition> findByFoodId(@Param("foodId") Long foodId);

    /**
     * 删除营养信息
     */
    @Delete("DELETE FROM nutrition WHERE id = #{id}")
    int deleteNutrition(@Param("id") Long id);
}