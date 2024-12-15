package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.NutritionAnalysis;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.time.LocalDate;
import java.util.List;

@Mapper
public interface NutritionAnalysisMapper extends BaseMapper<NutritionAnalysis> {
    
    NutritionAnalysis selectByUserIdAndDate(
        @Param("userId") Long userId,
        @Param("analysisDate") LocalDate analysisDate
    );
    
    List<NutritionAnalysis> selectByUserIdAndDateRange(
        @Param("userId") Long userId,
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );
    
    void calculateNutritionBalance(
        @Param("userId") Long userId,
        @Param("analysisDate") LocalDate analysisDate
    );
    
    List<NutritionAnalysis> selectTopBalancedUsers(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate,
        @Param("limit") Integer limit
    );
} 