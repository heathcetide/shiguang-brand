package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.UserDietaryGoals;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface UserDietaryGoalsMapper extends BaseMapper<UserDietaryGoals> {
    
    UserDietaryGoals selectByUserId(@Param("userId") Long userId);
    
    Boolean existsByUserId(@Param("userId") Long userId);
    
    List<UserDietaryGoals> selectByNutrientRange(
        @Param("nutrientType") String nutrientType,
        @Param("minValue") Float minValue,
        @Param("maxValue") Float maxValue
    );
} 