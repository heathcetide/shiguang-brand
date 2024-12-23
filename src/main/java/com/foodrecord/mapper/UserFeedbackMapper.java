package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.dto.FeedbackQueryDTO;
import com.foodrecord.model.entity.user.UserFeedback;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface UserFeedbackMapper extends BaseMapper<UserFeedback> {
    
    List<UserFeedback> selectByFoodId(@Param("foodId") Long foodId);
    
    List<UserFeedback> selectByUserId(@Param("userId") Long userId);
    
    Double selectAvgRatingByFoodId(@Param("foodId") Long foodId);
    
    IPage<UserFeedback> selectPageByFoodId(IPage<UserFeedback> page, @Param("foodId") Long foodId);

    /**
     * 高级查询反馈记录。
     */
    IPage<UserFeedback> queryFeedbacks(@Param("query") FeedbackQueryDTO queryDTO, IPage<UserFeedback> page);

    /**
     * 获取平均评分。
     */
    Double getAverageRating();

    @Select("select * from user_feedback")
    List<UserFeedback> findList();

    Page<UserFeedback> selectUserFeedbacks(Page<UserFeedback> objectPage, String keyword);
}