package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.DietaryPreferences;
import com.foodrecord.model.entity.UserProfile;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface UserProfileRepository extends BaseMapper<UserProfile> {
    /**
     * 获取用户画像
     */
    UserProfile findByUserId(@Param("userId") Long userId);
    
    /**
     * 更新用户饮食偏好
     */
    void updateDietaryPreferences(
        @Param("userId") Long userId,
        @Param("preferences") DietaryPreferences preferences
    );
} 