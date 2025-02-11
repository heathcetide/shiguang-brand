package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.FoodRecommendation;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface FoodRecommendationRepository extends BaseMapper<FoodRecommendation> {
    /**
     * 获取用户的食物推荐
     */
    List<FoodRecommendation> findByUserId(@Param("userId") Long userId);
    
    /**
     * 获取特定类型的推荐
     */
    List<FoodRecommendation> findByUserIdAndType(
        @Param("userId") Long userId,
        @Param("type") String type
    );
    
    /**
     * 获取评分最高的推荐
     */
    List<FoodRecommendation> findTopRecommendations(
        @Param("userId") Long userId,
        @Param("limit") int limit
    );
} 