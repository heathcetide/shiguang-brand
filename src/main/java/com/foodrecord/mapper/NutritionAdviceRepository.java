package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.NutritionAdvice;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.util.List;

@Mapper
public interface NutritionAdviceRepository extends BaseMapper<NutritionAdvice> {
    /**
     * 获取用户最近的营养建议
     */
    List<NutritionAdvice> findRecentByUserId(@Param("userId") Long userId, @Param("limit") int limit);
    
    /**
     * 获取特定时间段的营养建议
     */
    List<NutritionAdvice> findByUserIdAndDateRange(
        @Param("userId") Long userId,
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );
} 