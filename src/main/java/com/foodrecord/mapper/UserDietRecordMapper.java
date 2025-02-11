package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.UserDietRecord;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Mapper
public interface UserDietRecordMapper extends BaseMapper<UserDietRecord> {
    
    IPage<UserDietRecord> selectPageByUserId(IPage<UserDietRecord> page, @Param("userId") Long userId);
    
    List<UserDietRecord> selectByUserIdAndDateRange(
        @Param("userId") Long userId,
        @Param("startTime") LocalDateTime startTime,
        @Param("endTime") LocalDateTime endTime
    );
    
    List<UserDietRecord> selectByUserIdAndMealType(
        @Param("userId") Long userId,
        @Param("mealType") String mealType
    );
    
    List<UserDietRecord> selectDailyNutrition(
        @Param("userId") Long userId,
        @Param("date") LocalDateTime date
    );

    /**
     * 分页查询用户饮食记录
     */
    Page<UserDietRecord> findByUserId(@Param("userId") Long userId, Pageable pageable);

    /**
     * 按日期范围查询用户饮食记录
     */
    List<UserDietRecord> findByUserIdAndMealTimeBetween(
            @Param("userId") Long userId,
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime
    );

    /**
     * 查询每日饮食记录
     */
    List<UserDietRecord> selectDailyRecords(@Param("userId") Long userId, @Param("date") LocalDate date);

    /**
     * 按餐类型查询饮食记录
     */
    List<UserDietRecord> findByUserIdAndMealType(@Param("userId") Long userId, @Param("mealType") String mealType);

    /**
     * 按ID查找饮食记录
     */
    Optional<UserDietRecord> findById(@Param("id") Long id);

    /**
     * 根据用户 ID 和日期范围查询饮食统计数据
     *
     * @param userId    用户 ID
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 饮食统计列表
     */
    @Select("SELECT * FROM user_diet_record WHERE user_id = #{userId} " +
            "AND stats_date BETWEEN #{startDate} AND #{endDate}")
    List<UserDietRecord> selectByDateRange(@Param("userId") Long userId,
                                           @Param("startDate") LocalDate startDate,
                                           @Param("endDate") LocalDate endDate);


    /**
     * 根据用户ID查询最近n天的饮食记录
     *
     * @param userId 用户ID
     * @param days 最近的天数
     * @return 饮食记录列表
     */
    List<UserDietRecord> selectRecentByUserId(Long userId, int days);
}