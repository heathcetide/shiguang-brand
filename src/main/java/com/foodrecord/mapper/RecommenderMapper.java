package com.foodrecord.mapper;

import com.foodrecord.ml.entity.UserFoodInteraction;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import java.util.List;

@Mapper
public interface RecommenderMapper {
    
    @Select("SELECT * FROM user_food_interactions WHERE rating IS NOT NULL")
    List<UserFoodInteraction> getAllRatedInteractions();
    
    @Select("SELECT * FROM user_food_interactions WHERE user_id = #{userId}")
    List<UserFoodInteraction> getUserInteractions(Long userId);
    
    @Select("SELECT DISTINCT food_id FROM user_food_interactions")
    List<Long> getAllInteractedFoodIds();

//    @Select("call find_food_interactions()")
    @Select("SELECT * FROM user_food_interactions")
    List<UserFoodInteraction> getAllUserFoodInteractions();
}