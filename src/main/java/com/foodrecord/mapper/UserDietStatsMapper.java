package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.user.UserDietStats;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDate;
import java.util.List;

@Mapper
public interface UserDietStatsMapper extends BaseMapper<UserDietStats> {
    
    UserDietStats selectByUserIdAndDate(
        @Param("userId") Long userId,
        @Param("statsDate") LocalDate statsDate
    );
    
    List<UserDietStats> selectByUserIdAndDateRange(
        @Param("userId") Long userId,
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );
    
    void calculateDailyStats(
        @Param("userId") Long userId,
        @Param("statsDate") LocalDate statsDate
    );
    
    List<UserDietStats> selectTopAchievers(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate,
        @Param("limit") Integer limit
    );

    /**
     * 根据用户 ID 和日期范围查询饮食统计数据
     *
     * @param userId    用户 ID
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 饮食统计列表
     */
    @Select("SELECT * FROM user_diet_stats WHERE user_id = #{userId} " +
            "AND stats_date BETWEEN #{startDate} AND #{endDate}")
    List<UserDietStats> selectByDateRange(@Param("userId") Long userId,
                                          @Param("startDate") LocalDate startDate,
                                          @Param("endDate") LocalDate endDate);
} 