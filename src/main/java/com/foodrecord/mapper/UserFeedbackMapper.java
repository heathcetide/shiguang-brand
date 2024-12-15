package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.model.entity.UserFeedback;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface UserFeedbackMapper extends BaseMapper<UserFeedback> {
    
    List<UserFeedback> selectByFoodId(@Param("foodId") Long foodId);
    
    List<UserFeedback> selectByUserId(@Param("userId") Long userId);
    
    Double selectAvgRatingByFoodId(@Param("foodId") Long foodId);
    
    IPage<UserFeedback> selectPageByFoodId(IPage<UserFeedback> page, @Param("foodId") Long foodId);
} 