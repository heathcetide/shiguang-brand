package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.FoodRecommendation;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface FoodRecommendationMapper extends BaseMapper<FoodRecommendation> {
    /**
     * 根据用户ID分页查询推荐
     */
    @Select("SELECT * FROM food_recommendation WHERE user_id = #{userId} AND recommendation_type = #{type} ORDER BY recommendation_score DESC")
    IPage<FoodRecommendation> selectPageByUserId(Page<FoodRecommendation> page, @Param("userId") Long userId, @Param("type") String type);

    /**
     * 根据用户ID查询前N个推荐
     */
    @Select("SELECT * FROM food_recommendation WHERE user_id = #{userId} AND recommendation_type = #{type} ORDER BY recommendation_score DESC LIMIT #{limit}")
    List<FoodRecommendation> selectTopRecommendations(@Param("userId") Long userId, @Param("type") String type, @Param("limit") Integer limit);

    /**
     * 更新用户推荐的分数
     */
    @Update("UPDATE food_recommendation SET recommendation_score = recommendation_score + 1 WHERE user_id = #{userId} AND recommendation_type = #{type}")
    int updateRecommendationScores(@Param("userId") Long userId, @Param("type") String type);
} 