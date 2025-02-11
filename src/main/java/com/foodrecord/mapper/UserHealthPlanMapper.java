package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.UserHealthPlan;
import org.apache.ibatis.annotations.MapKey;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Date;
import java.util.List;
import java.util.Map;

@Mapper
public interface UserHealthPlanMapper extends BaseMapper<UserHealthPlan> {
    void insertBatch(@Param("plans") List<UserHealthPlan> plans);

    UserHealthPlan selectByUserIdAndDate(Long userId, @Param("planDate") Date planDate);

    List<UserHealthPlan> selectPlansByDateRange(Long userId, Date startDate, Date endDate);

    // 根据用户ID查找计划
    @Select("select * from user_health_plan where user_id = #{userId}")
    List<UserHealthPlan> findByUserId(Long userId);

    // 批量删除计划（自定义实现）
    void deleteBatchByIds(List<Long> planIds);

    List<UserHealthPlan> findAllWithPaginationAndKeyword(int offset, int size, String keyword);

    /**
     * 统计所有健康计划的数量
     *
     * @return 健康计划总数
     */
    int countTotalPlans();

    /**
     * 按状态统计健康计划的数量
     *
     * @return 各状态的计划数量
     */
    @MapKey("status")
    @Select("SELECT status AS status, COUNT(*) AS count FROM user_health_plan WHERE deleted = 0 GROUP BY status")
    Map<String, Long> countPlansByStatus();

    /**
     * 查询最新创建的健康计划
     *
     * @param limit 限制条数
     * @return 健康计划列表
     */
    List<UserHealthPlan> findLatestPlans(@Param("limit") int limit);

    /**
     * 查询指定时间范围内的健康计划
     *
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 健康计划列表
     */
    List<UserHealthPlan> findByDateRange(@Param("startDate") String startDate,
                                         @Param("endDate") String endDate);

    /**
     * 根据分类查询健康计划
     *
     * @param category 计划分类
     * @return 健康计划列表
     */
    List<UserHealthPlan> findByCategory(@Param("category") String category);
}
