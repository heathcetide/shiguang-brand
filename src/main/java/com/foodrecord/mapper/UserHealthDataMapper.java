package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.UserHealthData;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Optional;

@Mapper
public interface UserHealthDataMapper extends BaseMapper<UserHealthData> {
    
    UserHealthData selectByUserId(@Param("userId") Long userId);
    
    Boolean existsByUserId(@Param("userId") Long userId);
    
    List<UserHealthData> selectByBMIRange(
        @Param("minBMI") Float minBMI,
        @Param("maxBMI") Float maxBMI
    );

    /**
     * 根据用户ID查找健康数据
     */
    @Select("SELECT * FROM user_health_data WHERE user_id = #{userId}")
    Optional<UserHealthData> findByUserId(@Param("userId") Long userId);
}